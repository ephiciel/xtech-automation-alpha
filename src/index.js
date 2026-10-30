import { DurableObject } from "cloudflare:workers";

const BACKEND_PORT = 3000;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export class XtechBackend extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
      );
    }
  }

  getContainerEnv() {
    // Forward all string Worker variables/secrets into the Node container.
    // Durable Object bindings (such as BACKEND) are objects and are skipped.
    const result = {};

    for (const [key, value] of Object.entries(this.env)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }

    result.PORT = String(BACKEND_PORT);
    result.NODE_ENV = "production";

    return result;
  }

  async ensureBackendReady() {
    const container = this.ctx.container;

    if (!container) {
      throw new Error("Cloudflare Container binding is unavailable.");
    }

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "lite",
        enableInternet: true,
        env: this.getContainerEnv(),
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(BACKEND_PORT);
    let lastError;

    // Container startup is asynchronous. Wait until the existing XTECH
    // /api/status endpoint responds before proxying the user's request.
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const response = await port.fetch(
          `http://container/api/status`,
          {
            method: "GET",
            signal: AbortSignal.timeout(1000),
          }
        );

        await response.body?.cancel();

        // Any HTTP response proves Express is listening. A 2xx is ideal,
        // but even another HTTP status means the port is ready.
        if (response.status > 0) {
          return port;
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("XTECH Express backend did not become ready.", {
      cause: lastError,
    });
  }

  async fetch(request) {
    try {
      const port = await this.ensureBackendReady();

      const incoming = new URL(request.url);
      const target = new URL(request.url);

      target.protocol = "http:";
      target.hostname = "container";
      target.port = "";

      const headers = new Headers(request.headers);
      headers.delete("host");

      const init = {
        method: request.method,
        headers,
        redirect: "manual",
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }

      const proxiedRequest = new Request(target.toString(), init);
      return await port.fetch(proxiedRequest);
    } catch (error) {
      console.error("XTECH backend proxy error:", error);

      return Response.json(
        {
          error: "XTECH backend unavailable",
          message: error?.message || "Unknown backend error",
        },
        { status: 502 }
      );
    }
  }
}

export default {
  async fetch(request, env) {
    // One deterministic backend instance for the XTECH application.
    const backend = env.BACKEND.getByName("xtech-production");
    return backend.fetch(request);
  },
};
