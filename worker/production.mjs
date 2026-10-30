// Production entry point: delegates to the already-tested direct Worker.
// Keep legacy Durable Object classes exported during the rollback period.
// They are NOT called by the direct API and have no Container application
// in the active production Wrangler configuration.
import { DurableObject } from "cloudflare:workers";
import directWorker from "./direct.mjs";

export class XtechBackend extends DurableObject {}
export class XtechBackendV2 extends DurableObject {}

export default directWorker;
