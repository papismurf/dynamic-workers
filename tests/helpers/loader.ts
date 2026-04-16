/**
 * Fake implementation of the Worker Loader binding. src/index.ts calls
 * `env.LOADER.get(workerId, factory)` expecting a worker handle with
 * `.getEntrypoint(name)` returning an object exposing `run()`.
 *
 * The fake lets a test register a per-agent behavior by entrypoint name:
 *   const loader = createFakeLoader({
 *     CodeGenAgent: async () => JSON.stringify({ success: true, files: {} }),
 *   });
 * Unknown entrypoints throw, so coverage gaps surface loudly.
 */

export type AgentRunFn = () => Promise<string>;

export interface FakeLoader {
  binding: WorkerLoader;
  readonly invocations: Array<{ workerId: string; entrypoint: string }>;
}

export function createFakeLoader(
  entrypoints: Record<string, AgentRunFn>
): FakeLoader {
  const invocations: Array<{ workerId: string; entrypoint: string }> = [];

  const binding = {
    get(workerId: string, _factory: () => unknown): {
      getEntrypoint(name: string): { run: AgentRunFn };
    } {
      return {
        getEntrypoint(name: string) {
          const impl = entrypoints[name];
          if (!impl) {
            throw new Error(`No fake entrypoint registered for ${name}`);
          }
          return {
            async run() {
              invocations.push({ workerId, entrypoint: name });
              return impl();
            },
          };
        },
      };
    },
  };

  return { binding: binding as unknown as WorkerLoader, invocations };
}
