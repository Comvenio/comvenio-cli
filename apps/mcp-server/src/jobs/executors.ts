import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, OAuthScope } from "@comvenio/connector-contracts";

import type { ConnectorFileService } from "../files/service.ts";
import type { FileMetadataStore, QuarantineObjectPort } from "../files/types.ts";
import type { JobInputEnvelope } from "./input-store.ts";
import type { InternalJobRecord } from "./types.ts";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface JobExecutionContext {
  record: InternalJobRecord;
  envelope: JobInputEnvelope;
  /**
   * Obtains a fresh job actor immediately before a side effect: the
   * auth-service re-checks grant, revocation, binding and account on every
   * call. Returns a backend client authenticated with that actor; throws when
   * the actor is refused or unavailable, which ends the job. The file service
   * below authorizes with a capability snapshot resolved for the latest actor.
   */
  freshActor(): Promise<ComvenioApiClient>;
  /** File service whose authorization resolves a fresh capability snapshot with the latest job actor. */
  files: ConnectorFileService;
  file_metadata: FileMetadataStore;
  objects: QuarantineObjectPort;
  fetch: FetchLike;
  signal?: AbortSignal;
  reportProgress(percent: number): Promise<void>;
}

/** One background operation of the domain catalog that the worker can carry out. */
export interface JobExecutor {
  readonly action_id: string;
  readonly operation: string;
  /** Scopes the job actor is requested with; a subset of the action's OAuth scopes. */
  readonly required_scopes: readonly OAuthScope[];
  readonly fair_use_bucket: "import_export" | "heavy_job";
  readonly cancellable: boolean;
  execute(context: JobExecutionContext): Promise<JsonValue>;
}

function key(actionId: string, operation: string): string {
  return `${actionId}\u0000${operation}`;
}

/**
 * The only source for "a job action may be shown": an operation with a
 * job gate is visible exactly when an executor is registered here.
 */
export class JobExecutorRegistry {
  readonly #executors: ReadonlyMap<string, JobExecutor>;

  constructor(executors: readonly JobExecutor[]) {
    const entries = executors.map((executor) => [key(executor.action_id, executor.operation), executor] as const);
    const map = new Map(entries);
    if (map.size !== entries.length) throw new Error("Ein Job-Ausführer ist doppelt registriert.");
    this.#executors = map;
  }

  supports(actionId: string, operation: string): boolean {
    return this.#executors.has(key(actionId, operation));
  }

  get(actionId: string, operation: string): JobExecutor | null {
    return this.#executors.get(key(actionId, operation)) ?? null;
  }

  list(): JobExecutor[] {
    return [...this.#executors.values()];
  }
}
