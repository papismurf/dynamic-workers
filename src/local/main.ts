/**
 * Executable entry point for the local (no-Cloudflare) runtime.
 * Run with `npm run dev:local`. Kept separate from server.ts so the server
 * module stays side-effect-free and unit-testable.
 */
import { main } from "./server.js";

main();
