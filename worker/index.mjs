import { handleAsNodeRequest } from "cloudflare:node";
import serverModule from "../backend/server.js";

await serverModule.startServer();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleAsNodeRequest(3000, request);
    }

    return env.ASSETS.fetch(request);
  }
};
