// XTECH: direct Cloudflare Worker test entry point.
// No Docker, Containers or Durable Objects are used by this entry point.
// This file is for the separate xtech-api-direct-test Worker until all
// Firebase Authentication and Firestore operations have been tested.
import { httpServerHandler } from "cloudflare:node";
import serverModule from "../backend/server.js";

const nodeHandler = httpServerHandler({ port: 3000 });
let startPromise;

async function ensureStarted() {
  // Once per isolate; startup runs lazily to avoid expensive global work.
  if (!startPromise) {
    startPromise = serverModule.startServer().catch((error) => {
      startPromise = undefined;
      throw error;
    });
  }
  await startPromise;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Isolated preflight endpoint; does not access Firebase or reveal secrets.
    if (request.method === "GET" && url.pathname === "/__xtech_direct/health") {
      return Response.json({
        success: true,
        mode: "direct-worker-test",
        containerRequired: false,
        firebaseServiceAccountConfigured: Boolean(
          env.GOOGLE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_JSON
        ),
      });
    }

    // Serve the existing HTML/CSS/JS frontend from this test Worker.
    // Its relative /api/* calls will then target this Worker, not production.
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      await ensureStarted();
      return nodeHandler.fetch(request, env, ctx);
    } catch (error) {
      console.error("XTECH direct Worker startup failed:", error);
      return Response.json(
        {
          success: false,
          error: "XTECH direct Worker could not initialize",
          message: "Check the Worker logs and Firebase service-account configuration.",
        },
        { status: 503 }
      );
    }
  },
};
