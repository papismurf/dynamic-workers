/**
 * Shim for @cloudflare/worker-bundler — redirected by jest's moduleNameMapper.
 * `createWorker` is called inside runAgent() before the LOADER factory closure;
 * the fake LOADER never invokes that factory, so the returned shape only has
 * to satisfy TypeScript and the immediate destructure.
 */

export async function createWorker(_opts: unknown): Promise<{
  mainModule: string;
  modules: Record<string, string>;
}> {
  return { mainModule: "src/agent.js", modules: {} };
}
