import { handleAsNodeRequest } from "cloudflare:node";
import serverModule from "../backend/server.js";

await serverModule.startServer();

export default {
    fetch(request) {
        return handleAsNodeRequest(3000, request);
    }
};
