import { createComvenioApiClient } from "@comvenio/comvenio-client";
import type { Worker } from "bullmq";

import { domainToolName } from "./domain-runtime.ts";
import { ClamdMalwareScanner, type ClamdScannerConfig } from "./files/clamd-scanner.ts";
import { RedisFileMetadataStore } from "./files/redis-store.ts";
import { S3QuarantineObjectStore, createBunS3Backend, type S3QuarantineConfig } from "./files/s3-quarantine.ts";
import type { MalwareScannerPort, QuarantineObjectPort } from "./files/types.ts";
import { HttpCapabilityContextResolver } from "./http/upstreams.ts";
import type { ReadinessDependency } from "./http/types.ts";
import { BullMqJobQueue } from "./jobs/bullmq.ts";
import { DATA_UPLOAD_EXECUTOR } from "./jobs/data-upload-executor.ts";
import { JobExecutorRegistry } from "./jobs/executors.ts";
import { FairUseService, bundledRateLimitConfig, fairUseConfigReadiness } from "./jobs/fair-use.ts";
import { RedisJobInputStore } from "./jobs/input-store.ts";
import { HttpJobActorTokenPort } from "./jobs/job-actor.ts";
import { JobFilePlatform } from "./jobs/platform.ts";
import { DomainJobProcessor } from "./jobs/processor.ts";
import { RedisPlatformConnections } from "./jobs/redis.ts";
import { createComvenioJobWorker } from "./jobs/worker.ts";

/** The "uploads and jobs" configuration group; present only when every value is set. */
export interface JobsFilesConfig {
  redis_url: string;
  encryption_key: string;
  quarantine: S3QuarantineConfig;
  clamd: ClamdScannerConfig;
  job_binding_secret: string;
}

/** Adapter construction, replaceable in tests. */
export interface JobFileAdapterFactories {
  quarantine(config: S3QuarantineConfig): QuarantineObjectPort & { readInspected?(objectKey: string): AsyncIterable<Uint8Array> };
  scanner(config: ClamdScannerConfig, objects: ReturnType<JobFileAdapterFactories["quarantine"]>): MalwareScannerPort;
}

export const DEFAULT_JOB_FILE_ADAPTERS: JobFileAdapterFactories = Object.freeze({
  quarantine: (config: S3QuarantineConfig) =>
    new S3QuarantineObjectStore(config, { backend: createBunS3Backend(config) }),
  scanner: (config: ClamdScannerConfig, objects: ReturnType<JobFileAdapterFactories["quarantine"]>) => {
    const readInspected = objects.readInspected?.bind(objects);
    if (!readInspected) throw new Error("Der Quarantänespeicher liefert keine hash-gepinnten Scan-Bytes.");
    // Hash pinning: the scanner reads exactly the bytes the inspection hashed.
    return new ClamdMalwareScanner(config, (objectKey) => readInspected(objectKey));
  },
});

export interface RunningJobFilePlatform {
  platform: JobFilePlatform;
  readiness: ReadinessDependency[];
  close(): Promise<void>;
}

/**
 * Builds queue, worker (same process), fair use, encrypted job input,
 * file metadata, quarantine and scanner from the complete configuration.
 */
export async function startJobFilePlatform(input: {
  config: JobsFilesConfig;
  api_base_url: string;
  auth_base_url: string;
  internal_api_key: string;
  adapters?: JobFileAdapterFactories;
  on_lifecycle_event?: (event: Record<string, string>) => void;
}): Promise<RunningJobFilePlatform> {
  const adapters = input.adapters ?? DEFAULT_JOB_FILE_ADAPTERS;
  const connections = new RedisPlatformConnections(input.config.redis_url);
  let worker: Worker | null = null;
  let queue: BullMqJobQueue | null = null;
  try {
    await connections.producer.connect();
    const rateLimits = bundledRateLimitConfig();
    const fairUse = new FairUseService(rateLimits, connections.fair_use);
    queue = new BullMqJobQueue({ connection: connections.producer });
    const inputs = new RedisJobInputStore(connections.producer, Buffer.from(input.config.encryption_key, "base64url"));
    const fileMetadata = new RedisFileMetadataStore(connections.producer);
    const objects = adapters.quarantine(input.config.quarantine);
    const scanner = adapters.scanner(input.config.clamd, objects);
    const registry = new JobExecutorRegistry([DATA_UPLOAD_EXECUTOR]);
    const capabilities = new HttpCapabilityContextResolver({ api_base_url: input.api_base_url });
    const processor = new DomainJobProcessor({
      inputs,
      registry,
      actors: new HttpJobActorTokenPort({
        auth_base_url: input.auth_base_url,
        internal_api_key: input.internal_api_key,
        binding_secret: input.config.job_binding_secret,
      }),
      capabilities: {
        resolve: ({ context, backend_actor_token }) =>
          capabilities.resolve({ context, backend_actor_token, force_recheck: true }),
      },
      client_for: (token) => createComvenioApiClient({ gatewayBaseUrl: input.api_base_url, accessToken: token }),
      file_metadata: fileMetadata,
      objects,
      scanner,
      tool_name: domainToolName,
      on_failure: (event) => input.on_lifecycle_event?.({
        event: "comvenio_mcp_job_failed",
        job_id: event.job_id,
        action_id: event.action_id ?? "unknown",
        reason: event.reason,
      }),
    });
    worker = createComvenioJobWorker({
      connection: connections.worker,
      processor,
      queue,
      fairUse,
      onLifecycleError: (error) => input.on_lifecycle_event?.({
        event: "comvenio_mcp_job_lifecycle_error",
        error: error instanceof Error ? error.name : "unknown",
      }),
    });
    const platform = new JobFilePlatform({
      queue,
      fair_use: fairUse,
      inputs,
      file_metadata: fileMetadata,
      objects,
      scanner,
      registry,
      tool_name: domainToolName,
    });
    const runningQueue = queue;
    const runningWorker = worker;
    return {
      platform,
      readiness: [
        fairUseConfigReadiness(rateLimits),
        { name: "jobs_queue", required: true, check: () => runningQueue.readiness() },
      ],
      async close() {
        await Promise.allSettled([runningWorker.close(), runningQueue.close()]);
        await connections.close();
      },
    };
  } catch (error) {
    await Promise.allSettled([worker?.close(), queue?.close()]);
    await connections.close();
    throw error;
  }
}
