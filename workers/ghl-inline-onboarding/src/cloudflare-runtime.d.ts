declare module "cloudflare:workers" {
  export interface SqlStorageCursor<T> {
    toArray(): T[]
  }

  export interface SqlStorage {
    exec<T = Record<string, unknown>>(
      query: string,
      ...bindings: unknown[]
    ): SqlStorageCursor<T>
  }

  export interface DurableObjectStorage {
    sql: SqlStorage
  }

  export interface DurableObjectState {
    storage: DurableObjectStorage
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  }

  export abstract class DurableObject<Env> {
    protected readonly ctx: DurableObjectState
    protected readonly env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }

  export interface DurableObjectNamespace<T> {
    getByName(name: string): T
  }
}
