import type { CapabilitySnapshot } from "@comvenio/auth";
import type { RequestContext } from "@comvenio/connector-contracts";

import { ConnectorFileService } from "../files/service.ts";
import type { FileMetadataStore, MalwareScannerPort, QuarantineObjectPort } from "../files/types.ts";
import {
  SnapshotFileAuthorization,
  SnapshotJobAuthorization,
  executorScopesByToolName,
} from "./authorization.ts";
import type { JobExecutorRegistry } from "./executors.ts";
import { FairUseService } from "./fair-use.ts";
import type { JobInputStore } from "./input-store.ts";
import { AsyncJobService } from "./service.ts";
import { DomainJobStarter, type JobCallBinding } from "./starter.ts";
import type { JobQueuePort } from "./types.ts";

export interface JobFilePlatformParts {
  queue: JobQueuePort;
  fair_use: FairUseService;
  inputs: JobInputStore;
  file_metadata: FileMetadataStore;
  objects: QuarantineObjectPort;
  scanner: MalwareScannerPort;
  registry: JobExecutorRegistry;
  /** Tool name of a domain action (domain-runtime's naming), injected to avoid an import cycle. */
  tool_name: (actionId: string) => string;
}

/** Services bound to one MCP request: its context and its capability snapshot. */
export interface JobFileRequestBinding {
  jobs: AsyncJobService;
  files: ConnectorFileService;
  job_starter: DomainJobStarter;
}

/**
 * Process-wide jobs, uploads and fair use (K15, D-CAI-023). It exists only
 * when the "uploads and jobs" configuration group is complete; without it the
 * runtime registers no file or job tools and every job action stays hidden.
 */
export class JobFilePlatform {
  readonly #scopes: ReturnType<typeof executorScopesByToolName>;

  constructor(readonly parts: JobFilePlatformParts) {
    this.#scopes = executorScopesByToolName(parts.registry, parts.tool_name);
  }

  bind(input: {
    context: RequestContext;
    capability_snapshot: CapabilitySnapshot | null;
    call: () => JobCallBinding | undefined;
  }): JobFileRequestBinding {
    const snapshot = async () => input.capability_snapshot;
    const jobs = new AsyncJobService(
      this.parts.queue,
      new SnapshotJobAuthorization(snapshot, this.#scopes),
      this.parts.fair_use,
    );
    const files = new ConnectorFileService(
      this.parts.file_metadata,
      this.parts.objects,
      this.parts.scanner,
      new SnapshotFileAuthorization(snapshot),
    );
    return {
      jobs,
      files,
      job_starter: new DomainJobStarter({
        jobs,
        inputs: this.parts.inputs,
        registry: this.parts.registry,
        tool_name: this.parts.tool_name,
        call: input.call,
      }),
    };
  }
}
