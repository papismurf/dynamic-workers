import { WorkerEntrypoint } from "cloudflare:workers";

interface MemoryProps {
  namespace: string;
  kvBinding: KVNamespace;
}

/**
 * Memory RPC binding — persists learnings, conventions, and context
 * across agent invocations using Workers KV. Scoped by namespace
 * (typically repo or project identifier).
 */
export class Memory extends WorkerEntrypoint<Env, MemoryProps> {
  private get props() {
    return this.ctx.props;
  }

  private key(userKey: string): string {
    return `${this.props.namespace}:${userKey}`;
  }

  async get(key: string): Promise<string | null> {
    return this.props.kvBinding.get(this.key(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = {};
    if (ttlSeconds) {
      options.expirationTtl = ttlSeconds;
    }
    await this.props.kvBinding.put(this.key(key), value, options);
  }

  async list(prefix: string): Promise<string[]> {
    const fullPrefix = this.key(prefix);
    const result = await this.props.kvBinding.list({ prefix: fullPrefix });
    const prefixLen = `${this.props.namespace}:`.length;
    return result.keys.map((k) => k.name.slice(prefixLen));
  }

  async delete(key: string): Promise<void> {
    await this.props.kvBinding.delete(this.key(key));
  }
}
