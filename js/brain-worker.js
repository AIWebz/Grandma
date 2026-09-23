/*
 * Grandma AI — runs the in-browser AI engine off the main thread so the page
 * stays smooth while Grandma thinks. Loaded as a module worker by js/brain.js.
 */
import { WebWorkerMLCEngineHandler } from "../vendor/web-llm/index.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
