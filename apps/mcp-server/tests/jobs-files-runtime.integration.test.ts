import { createHash, createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";
import type { CapabilitySnapshot } from "@comvenio/auth";
import type { ComvenioApiClient, ComvenioApiRequest } from "@comvenio/comvenio-client";
import {
  createConnectorError,
  type JsonValue,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UnrecoverableError } from "bullmq";

import { readMcpProcessConfig } from "../src/bootstrap.ts";
import { domainToolName } from "../src/domain-runtime.ts";
import { InMemoryDomainStateStore } from "../src/domain-state-store.ts";
import { MemoryFileMetadataStore } from "../src/files/memory-store.ts";
import type {
  InternalConnectorFileRecord,
  InternalUploadRecord,
  MalwareScannerPort,
  QuarantineObjectPort,
} from "../src/files/types.ts";
import type { StatelessTransportContext } from "../src/http/types.ts";
import { SnapshotFileAuthorization } from "../src/jobs/authorization.ts";
import { DATA_UPLOAD_EXECUTOR } from "../src/jobs/data-upload-executor.ts";
import { projectBullJob } from "../src/jobs/bullmq.ts";
import { JobExecutorRegistry } from "../src/jobs/executors.ts";
import { FairUseService, MemoryFairUseStore, bundledRateLimitConfig } from "../src/jobs/fair-use.ts";
import { MemoryJobInputStore } from "../src/jobs/input-store.ts";
import {
  HttpJobActorTokenPort,
  JobActorRevokedError,
  JobActorUnavailableError,
  type JobActorPort,
} from "../src/jobs/job-actor.ts";
import { MemoryJobQueue } from "../src/jobs/memory-queue.ts";
import { JobFilePlatform } from "../src/jobs/platform.ts";
import { DomainJobProcessor } from "../src/jobs/processor.ts";
import { createRuntimeServer } from "../src/runtime-tools.ts";

const clubId = "15151515-1515-4515-8515-151515151515";
const otherClubId = "16161616-1616-4616-8616-161616161616";
const subjectId = "17171717-1717-4717-8717-171717171717";
const grantId = "18181818-1818-4818-8818-181818181818";
const uploadId = "19191919-1919-4919-8919-191919191919";
const sourceFileId = "20202020-2020-4020-8020-202020202020";
const contentFileId = "21212121-2121-4121-8121-212121212121";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const secretFilename = "vertrauliche-mitgliederliste.pdf";
const bindingSecret = "job-binding-secret-for-tests-only-0123456789";
const fileBytes = new TextEncoder().encode("%PDF-1.7 synthetic connector upload");
const fileSha256 = createHash("sha256").update(fileBytes).digest("hex");

const uploadToolName = domainToolName("cai.data.06.upload");
const downloadToolName = domainToolName("cai.data.05.download");
const PLATFORM_TOOLS = [
  "cv_file_get_read",
  "cv_file_upload_complete_write",
  "cv_file_upload_start_write",
  "cv_job_cancel_write",
  "cv_job_status_read",
];

const context: RequestContext = {
  request_id: "23232323-2323-4323-8323-232323232323",
  surface: "mcp",
  provider: "openai",
  subject_id: subjectId,
  oauth_grant_id: grantId,
  club_id: clubId,
  department_id: null,
  scopes: ["club.read", "files.export", "files.import", "files.read", "files.write"],
  capability_version: "cap-v1",
  locale: "de-DE",
  timezone: "Europe/Berlin",
};

function snapshotFor(club = clubId): CapabilitySnapshot {
  return {
    subject_id: subjectId,
    member_id: "24242424-2424-4424-8424-242424242424",
    club_id: club,
    department_ids: [],
    permissions: { read_files: true, write_files: true },
    sources: [],
    capability_version: "cap-v1",
    generated_at: new Date().toISOString(),
    observed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function uploadInput(overrides: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    source_file_id: sourceFileId,
    filename: secretFilename,
    content_type: "application/pdf",
    expected_size: fileBytes.byteLength,
    context_type: "club",
    visibility: "private",
    ...overrides,
  };
}

async function seedCleanFile(metadata: MemoryFileMetadataStore, input: {
  upload_state?: "clean" | "scanning";
  club?: string;
} = {}): Promise<void> {
  const club = input.club ?? clubId;
  const state = input.upload_state ?? "clean";
  const now = new Date();
  const upload: InternalUploadRecord = {
    handle: {
      upload_id: uploadId,
      club_id: club,
      owner_subject_id: subjectId,
      upload_url: null,
      required_headers: null,
      state,
      expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
      file_id: state === "clean" ? sourceFileId : null,
      rejection_code: null,
    },
    oauth_grant_id: grantId,
    owner_subject_id: subjectId,
    capability_version: "cap-v1",
    filename: secretFilename,
    mime_type: "application/pdf",
    size_bytes: fileBytes.byteLength,
    purpose: "club_file",
    object_key: `mcp-quarantine/${club}/${uploadId}`,
    staged_file_id: sourceFileId,
    rejection_sha256: null,
    created_at: now.toISOString(),
  };
  const file: InternalConnectorFileRecord = {
    file_id: sourceFileId,
    upload_id: uploadId,
    oauth_grant_id: grantId,
    owner_subject_id: subjectId,
    club_id: club,
    capability_version: "cap-v1",
    name: secretFilename,
    mime_type: "application/pdf",
    size_bytes: fileBytes.byteLength,
    sha256: fileSha256,
    purpose: "club_file",
    object_key: `mcp-clean/${sourceFileId}`,
    state: "clean",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    consumed_at: null,
  };
  await metadata.createUpload(upload);
  if (state === "clean") await metadata.createFile(file);
}

function fakeObjects(): QuarantineObjectPort {
  return {
    async createPresignedUpload(input) {
      return {
        url: "https://quarantine.test/put",
        required_headers: { "Content-Type": input.mime_type, "Content-Length": String(input.size_bytes), "If-None-Match": "*" },
      };
    },
    async inspect() { throw new Error("not used"); },
    async release() {},
    async delete() {},
    async promoteClean() { throw new Error("not used"); },
    async createPresignedDownload(input) {
      return { url: `https://quarantine.test/get/${encodeURIComponent(input.object_key)}`, expires_at: new Date(Date.now() + 300_000).toISOString() };
    },
  };
}

const cleanScanner: MalwareScannerPort = { async scan() { return "clean"; } };

function setup(options: { snapshot?: CapabilitySnapshot } = {}) {
  const queue = new MemoryJobQueue();
  const inputs = new MemoryJobInputStore();
  const metadata = new MemoryFileMetadataStore();
  const objects = fakeObjects();
  const registry = new JobExecutorRegistry([DATA_UPLOAD_EXECUTOR]);
  const platform = new JobFilePlatform({
    queue,
    fair_use: new FairUseService(bundledRateLimitConfig(), new MemoryFairUseStore()),
    inputs,
    file_metadata: metadata,
    objects,
    scanner: cleanScanner,
    registry,
    tool_name: domainToolName,
  });
  const backendCalls: ComvenioApiRequest[] = [];
  const transfers: Array<{ method: string; url: string }> = [];
  let presignFailure: Error | null = null;
  const client: ComvenioApiClient = {
    timeout_ms: 15000,
    async request<T extends JsonValue>(request: ComvenioApiRequest): Promise<T> {
      backendCalls.push(structuredClone(request));
      if (request.path === "/files/presign-upload") {
        if (presignFailure) throw presignFailure;
        return { file_id: contentFileId, object_key: "club/x.pdf", upload_url: "https://s3.test/put/x", headers: { "Content-Type": "application/pdf" } } as unknown as T;
      }
      if (request.path === `/files/${contentFileId}/finalize`) return { ok: true, etag: "e", size_bytes: fileBytes.byteLength } as unknown as T;
      throw new Error(`unexpected ${request.path}`);
    },
  };
  const actorRequests: Array<Parameters<JobActorPort["exchange"]>[0]> = [];
  let actors: JobActorPort = {
    async exchange(input) {
      actorRequests.push(structuredClone(input));
      return { access_token: "job-actor-token-0123456789", expires_in: 300 };
    },
  };
  const failures: Array<Record<string, string | null>> = [];
  const processor = () => new DomainJobProcessor({
    inputs,
    registry,
    actors,
    capabilities: { async resolve() { return options.snapshot ?? snapshotFor(); } },
    client_for: () => client,
    file_metadata: metadata,
    objects,
    scanner: cleanScanner,
    tool_name: domainToolName,
    fetch: async (url, init) => {
      const target = String(url);
      transfers.push({ method: init?.method ?? "GET", url: target });
      if (target.startsWith("https://quarantine.test/get/")) return new Response(fileBytes, { status: 200 });
      if (target === "https://s3.test/put/x") return new Response(null, { status: 200 });
      return new Response(null, { status: 404 });
    },
    on_failure: (event) => { failures.push({ ...event }); },
  });
  return {
    queue,
    inputs,
    metadata,
    platform,
    backendCalls,
    transfers,
    actorRequests,
    failures,
    processor,
    failPresign(error: Error) { presignFailure = error; },
    useActors(port: JobActorPort) { actors = port; },
  };
}

async function startUploadJob(platform: JobFilePlatform, input = uploadInput()): Promise<{ job_id: string }> {
  const binding = platform.bind({
    context,
    capability_snapshot: snapshotFor(),
    call: () => ({ action_id: "cai.data.06.upload", operation: "upload", idempotency_key: idempotencyKey }),
  });
  const handle = await binding.job_starter.start({
    definition: { action_id: "cai.data.06.upload" },
    operation: { operation: "upload" },
    input: { club_id: clubId, ...input },
    context,
  }) as { job_id: string };
  return handle;
}

async function runJob(state: ReturnType<typeof setup>, jobId: string): Promise<unknown> {
  const record = await state.queue.get(jobId);
  if (!record) throw new Error("job missing");
  try {
    await state.processor().process({ record, async reportProgress() {} });
    return null;
  } catch (error) {
    return error;
  }
}

async function listedTools(jobFiles: JobFilePlatform | null): Promise<string[]> {
  const transportContext: StatelessTransportContext = {
    provider_request: {
      request_id: context.request_id,
      provider: "openai",
      client_kind: "chatgpt",
      authenticated: true,
      protocol_version: null,
      received_at: new Date().toISOString(),
    },
    request: context,
    capability_snapshot: snapshotFor(),
    backend_actor_token: "backend-actor-token-0123456789",
    risk: "read",
  };
  const server = createRuntimeServer({
    environment: "development",
    api_base_url: "https://api.example.test",
    public_origin: "https://mcpdev.comvenio.app",
    context: transportContext,
    domain_state_store: new InMemoryDomainStateStore(),
    release_scope: "full_connector_v1",
    job_files: jobFiles,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  const tools = await client.listTools();
  await client.close();
  return tools.tools.map((tool) => tool.name);
}

const baseEnvironment = {
  COMVENIO_MCP_ENV: "development",
  INTERNAL_API_KEY: "test-internal-key",
  MCP_SHARED_STATE_REDIS_URL: "rediss://redis.example.test:6380/0",
  MCP_SHARED_STATE_ENCRYPTION_KEY: "A".repeat(43),
};
const jobsFilesEnvironment = {
  MCP_UPLOAD_S3_ENDPOINT: "https://s3.example.test",
  MCP_UPLOAD_S3_REGION: "eu-central-1",
  MCP_UPLOAD_S3_BUCKET: "comvenio-mcp-quarantine",
  MCP_UPLOAD_S3_ACCESS_KEY_ID: "access-key-id-for-tests",
  MCP_UPLOAD_S3_SECRET_ACCESS_KEY: "secret-access-key-value-for-tests",
  MCP_CLAMD_HOST: "clamd.railway.internal",
  MCP_CLAMD_PORT: "3310",
  JOB_BINDING_SECRET: bindingSecret,
};

describe("K15b uploads and jobs configuration group", () => {
  test("stays off with a missing value and names only the missing variables", () => {
    const off = readMcpProcessConfig(baseEnvironment);
    expect(off.jobs_files).toBeNull();
    expect(off.jobs_files_missing).toContain("JOB_BINDING_SECRET");
    const partial = readMcpProcessConfig({ ...baseEnvironment, ...jobsFilesEnvironment, MCP_CLAMD_HOST: undefined });
    expect(partial.jobs_files).toBeNull();
    expect(partial.jobs_files_missing).toEqual(["MCP_CLAMD_HOST"]);
    expect(JSON.stringify(partial.jobs_files_missing)).not.toContain(jobsFilesEnvironment.MCP_UPLOAD_S3_SECRET_ACCESS_KEY);
  });

  test("turns on only with every value and rejects a malformed one without echoing it", () => {
    const on = readMcpProcessConfig({ ...baseEnvironment, ...jobsFilesEnvironment });
    expect(on.jobs_files?.clamd).toEqual({ host: "clamd.railway.internal", port: 3310 });
    expect(on.jobs_files?.quarantine.bucket).toBe("comvenio-mcp-quarantine");
    expect(on.jobs_files_missing).toEqual([]);
    let message = "";
    try {
      readMcpProcessConfig({ ...baseEnvironment, ...jobsFilesEnvironment, JOB_BINDING_SECRET: "short-secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("JOB_BINDING_SECRET");
    expect(message).not.toContain("short-secret-value");
  });
});

describe("K15b runtime visibility", () => {
  test("configuration off: no platform tools and no job actions", async () => {
    const names = await listedTools(null);
    for (const name of PLATFORM_TOOLS) expect(names).not.toContain(name);
    expect(names).not.toContain(uploadToolName);
    expect(names).not.toContain(downloadToolName);
  });

  test("configuration on: platform tools and data.06 appear, job actions without executor stay hidden", async () => {
    const names = await listedTools(setup().platform);
    for (const name of PLATFORM_TOOLS) expect(names).toContain(name);
    expect(names).toContain(uploadToolName);
    expect(names).not.toContain(downloadToolName);
    expect(names).not.toContain(domainToolName("cai.verify.01.url"));
  });
});

describe("K15b job start (D-CAI-023)", () => {
  test("stores the input encrypted-at-rest per job, carries no token and stays idempotent", async () => {
    const state = setup();
    const first = await startUploadJob(state.platform);
    const retry = await startUploadJob(state.platform);
    expect(retry.job_id).toBe(first.job_id);
    const envelope = await state.inputs.get(first.job_id);
    expect(envelope?.action_id).toBe("cai.data.06.upload");
    expect(envelope?.context.oauth_grant_id).toBe(grantId);
    expect(JSON.stringify(envelope)).not.toContain("token");
    const record = await state.queue.get(first.job_id);
    expect(JSON.stringify(record)).not.toContain(secretFilename);
    await expect(startUploadJob(state.platform, uploadInput({ filename: "andere-datei.pdf" })))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("fixes the binding expiry once; an idempotent restart keeps it", async () => {
    const state = setup();
    const before = Date.now();
    const first = await startUploadJob(state.platform);
    const stored = (await state.inputs.get(first.job_id))?.binding_expires_at;
    const expiresAt = Date.parse(stored ?? "");
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt - before).toBeLessThanOrEqual(24 * 60 * 60 * 1_000);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await startUploadJob(state.platform);
    expect((await state.inputs.get(first.job_id))?.binding_expires_at).toBe(stored!);
  });
});

describe("K15b executor cai.data.06.upload", () => {
  test("consumes the clean file exactly once and runs presign -> PUT -> finalize", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    const job = await startUploadJob(state.platform);
    expect(await runJob(state, job.job_id)).toBeNull();
    expect(state.backendCalls.map((call) => `${call.method} ${call.service} ${call.path}`)).toEqual([
      "POST content /files/presign-upload",
      `POST content /files/${contentFileId}/finalize`,
    ]);
    expect(state.backendCalls[0]?.body).toMatchObject({ club_id: clubId, filename: secretFilename, expected_size: fileBytes.byteLength });
    expect(state.transfers.map((transfer) => transfer.method)).toEqual(["GET", "PUT"]);
    expect((await state.metadata.getFile(sourceFileId))?.state).toBe("consumed");
    // One actor for the run plus a fresh one before each side effect: consume, presign, PUT, finalize.
    expect(state.actorRequests).toHaveLength(5);
    expect(await state.inputs.get(job.job_id)).toBeNull();

    // A second run of the same job (BullMQ retry) cannot consume again.
    await state.inputs.put({
      job_id: job.job_id,
      action_id: "cai.data.06.upload",
      operation: "upload",
      input: { club_id: clubId, ...uploadInput() },
      context,
      binding_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }, 60_000);
    const again = await runJob(state, job.job_id);
    expect(again).toBeInstanceOf(UnrecoverableError);
    expect(state.backendCalls).toHaveLength(2);
  });

  test("the worker returns the DataShare file as job result; only the job owner reads it", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    const job = await startUploadJob(state.platform);
    const record = await state.queue.get(job.job_id);
    if (!record) throw new Error("job missing");
    const outcome = await state.processor().process({ record, async reportProgress() {} });
    const expected = {
      kind: "datashare_file" as const,
      file_id: contentFileId,
      filename: secretFilename,
      content_type: "application/pdf",
      size_bytes: fileBytes.byteLength,
    };
    // Only the minimized fields: no club, visibility, context, object key, URL or hash.
    expect(outcome).toEqual({ result_file_id: null, result: expected, error_code: null });

    // BullMQ persists the processor's return value; the completed job projects it onto the handle.
    const projected = projectBullJob(record, {
      progress: 100,
      processedOn: Date.parse("2026-09-29T10:00:00.000Z"),
      finishedOn: Date.parse("2026-09-29T10:00:05.000Z"),
      returnvalue: outcome,
    }, "completed");
    expect(projected.handle).toMatchObject({ state: "succeeded", result_file_id: null, result: expected });
    // Before completion, and for a record stored before the field existed, the result stays null.
    const legacy = structuredClone(record) as unknown as { handle: Record<string, unknown> };
    delete legacy.handle.result;
    expect(projectBullJob(legacy as unknown as typeof record, { progress: 40, returnvalue: outcome }, "active").handle.result).toBeNull();

    await state.queue.complete(job.job_id, outcome, new Date().toISOString());
    const owner = state.platform.bind({ context, capability_snapshot: snapshotFor(), call: () => undefined });
    expect(await owner.jobs.status({ context, club_id: clubId, job_id: job.job_id })).toMatchObject({
      state: "succeeded",
      result: expected,
    });
    const foreignContext = { ...context, subject_id: "27272727-2727-4727-8727-272727272727" };
    const foreign = state.platform.bind({ context: foreignContext, capability_snapshot: snapshotFor(), call: () => undefined });
    await expect(foreign.jobs.status({ context: foreignContext, club_id: clubId, job_id: job.job_id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a file of another club is refused before anything is consumed", async () => {
    const state = setup();
    await seedCleanFile(state.metadata, { club: otherClubId });
    const job = await startUploadJob(state.platform);
    expect(await runJob(state, job.job_id)).toBeInstanceOf(UnrecoverableError);
    expect(state.backendCalls).toHaveLength(0);
    expect((await state.metadata.getFile(sourceFileId))?.state).toBe("clean");
  });

  test("an infected or still scanning upload is refused", async () => {
    const infected = setup();
    // A rejected (e.g. MALWARE) upload never gets a connector file record.
    const infectedJob = await startUploadJob(infected.platform);
    expect(await runJob(infected, infectedJob.job_id)).toBeInstanceOf(UnrecoverableError);
    expect(infected.backendCalls).toHaveLength(0);

    const pending = setup();
    await seedCleanFile(pending.metadata, { upload_state: "scanning" });
    await pending.metadata.createFile({
      file_id: sourceFileId, upload_id: uploadId, oauth_grant_id: grantId, owner_subject_id: subjectId, club_id: clubId,
      capability_version: "cap-v1", name: secretFilename, mime_type: "application/pdf", size_bytes: fileBytes.byteLength,
      sha256: fileSha256, purpose: "club_file", object_key: `mcp-clean/${sourceFileId}`, state: "clean",
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null,
    });
    const pendingJob = await startUploadJob(pending.platform);
    expect(await runJob(pending, pendingJob.job_id)).toBeInstanceOf(UnrecoverableError);
    expect(pending.backendCalls).toHaveLength(0);
    expect((await pending.metadata.getFile(sourceFileId))?.state).toBe("clean");
  });

  test("a domain service error fails the job without leaking input or upstream text", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    state.failPresign(createConnectorError({
      code: "UPSTREAM_UNAVAILABLE",
      message: `content-service 500 for ${secretFilename}`,
      request_id: context.request_id,
      retryable: true,
    }));
    const job = await startUploadJob(state.platform);
    const error = await runJob(state, job.job_id);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).not.toContain(secretFilename);
    expect(JSON.stringify(state.failures)).not.toContain(secretFilename);
    expect(await state.inputs.get(job.job_id)).toBeNull();
  });
});

describe("K15b effective club rights (finding 1)", () => {
  test("file actions need the club rights of the file profiles, not only the scopes", async () => {
    const withRights = (permissions: Record<string, boolean>) =>
      new SnapshotFileAuthorization(async () => ({ ...snapshotFor(), permissions }));
    const none = withRights({});
    await expect(none.reauthorize({ context, action: "upload_start", purpose: "club_file" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(none.reauthorize({ context, action: "upload_complete", purpose: "club_file" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(none.reauthorize({ context, action: "file_get", purpose: "club_file" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(none.reauthorize({ context, action: "file_consume", purpose: "club_file" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    const reader = withRights({ read_files: true });
    await expect(reader.reauthorize({ context, action: "file_get", purpose: "job_result" })).resolves.toEqual({ capability_version: "cap-v1" });
    await expect(reader.reauthorize({ context, action: "upload_start", purpose: "club_file" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(reader.reauthorize({ context, action: "file_consume", purpose: "club_file" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    // Any right of the file_write profile suffices, e.g. news editors.
    const newsEditor = withRights({ manage_news: true });
    await expect(newsEditor.reauthorize({ context, action: "upload_start", purpose: "news_asset" })).resolves.toEqual({ capability_version: "cap-v1" });
  });

  test("the worker evaluates a fresh snapshot with changed version before consuming", async () => {
    const state = setup({ snapshot: { ...snapshotFor(), capability_version: "cap-v2", permissions: { read_files: true } } });
    await seedCleanFile(state.metadata);
    const job = await startUploadJob(state.platform);
    expect(await runJob(state, job.job_id)).toBeInstanceOf(UnrecoverableError);
    expect(state.backendCalls).toHaveLength(0);
    expect((await state.metadata.getFile(sourceFileId))?.state).toBe("clean");

    // With the rights still present, a newer capability version alone does not block the job.
    const granted = setup({ snapshot: { ...snapshotFor(), capability_version: "cap-v2" } });
    await seedCleanFile(granted.metadata);
    const grantedJob = await startUploadJob(granted.platform);
    expect(await runJob(granted, grantedJob.job_id)).toBeNull();
  });
});

describe("K15b revocation before every side effect (finding 2)", () => {
  function revokingAfter(state: ReturnType<typeof setup>, allowed: number): void {
    let calls = 0;
    state.useActors({
      async exchange(input) {
        state.actorRequests.push(structuredClone(input));
        calls += 1;
        if (calls > allowed) throw new JobActorRevokedError();
        return { access_token: "job-actor-token-0123456789", expires_in: 300 };
      },
    });
  }

  test("a grant revoked after the actor check stops the job before the consumption", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    revokingAfter(state, 1);
    const job = await startUploadJob(state.platform);
    expect(await runJob(state, job.job_id)).toBeInstanceOf(UnrecoverableError);
    expect((await state.metadata.getFile(sourceFileId))?.state).toBe("clean");
    expect(state.backendCalls).toHaveLength(0);
    expect(state.transfers).toHaveLength(0);
  });

  test("a grant revoked after presign-upload stops the job before the PUT and the finalize", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    revokingAfter(state, 3);
    const job = await startUploadJob(state.platform);
    expect(await runJob(state, job.job_id)).toBeInstanceOf(UnrecoverableError);
    expect(state.backendCalls.map((call) => call.path)).toEqual(["/files/presign-upload"]);
    expect(state.transfers.map((transfer) => transfer.method)).toEqual(["GET"]);
  });

  test("the binding expiry is fixed at job start and reused by every attempt", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    const job = await startUploadJob(state.platform);
    const stored = (await state.inputs.get(job.job_id))?.binding_expires_at;
    expect(typeof stored).toBe("string");

    // First attempt: the auth-service is unavailable, nothing consumed, BullMQ retries.
    let first = true;
    state.useActors({
      async exchange(input) {
        state.actorRequests.push(structuredClone(input));
        if (first) {
          first = false;
          throw new JobActorUnavailableError();
        }
        return { access_token: "job-actor-token-0123456789", expires_in: 300 };
      },
    });
    const retry = await runJob(state, job.job_id);
    expect(retry).toBeInstanceOf(Error);
    expect(retry).not.toBeInstanceOf(UnrecoverableError);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await runJob(state, job.job_id)).toBeNull();
    expect(state.actorRequests.length).toBeGreaterThan(1);
    for (const request of state.actorRequests) expect(request.expires_at).toBe(stored!);
  });

  test("an envelope without a binding expiry is refused", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    const job = await startUploadJob(state.platform);
    const envelope = await state.inputs.get(job.job_id);
    await state.inputs.delete(job.job_id);
    const legacy: Record<string, unknown> = { ...envelope! };
    delete legacy.binding_expires_at;
    await state.inputs.put(legacy as unknown as NonNullable<typeof envelope>, 60_000);
    expect(await runJob(state, job.job_id)).toBeInstanceOf(UnrecoverableError);
    expect(state.actorRequests).toHaveLength(0);
    expect((await state.metadata.getFile(sourceFileId))?.state).toBe("clean");
  });
});

describe("K15b job actor exchange", () => {
  test("signs the job binding with HMAC-SHA256 over the agreed fields", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const port = new HttpJobActorTokenPort({
      auth_base_url: "https://api.example.test/auth",
      internal_api_key: "test-internal-key",
      binding_secret: bindingSecret,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({ access_token: "job-actor-token-0123456789", token_type: "Bearer", expires_in: 300 });
      },
    });
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const jobId = "25252525-2525-4525-8525-252525252525";
    const actor = await port.exchange({
      request_id: context.request_id,
      job_id: jobId,
      action_id: "cai.data.06.upload",
      grant_id: grantId,
      subject_id: subjectId,
      club_id: clubId,
      scopes: ["files.write", "files.import"],
      expires_at: expiresAt,
    });
    expect(actor.expires_in).toBe(300);
    expect(requests[0]?.url).toBe("https://api.example.test/auth/oauth/job-actor-token");
    expect((requests[0]?.init.headers as Record<string, string>)["x-internal-api-key"]).toBe("test-internal-key");
    const body = JSON.parse(String(requests[0]?.init.body));
    const expected = createHmac("sha256", bindingSecret)
      .update(`${jobId}|cai.data.06.upload|${grantId}|${subjectId}|${clubId}|${expiresAt}|files.import files.write`)
      .digest("hex");
    expect(body).toEqual({
      grant_id: grantId,
      subject_id: subjectId,
      club_id: clubId,
      scopes: ["files.import", "files.write"],
      job_binding: { job_id: jobId, action_id: "cai.data.06.upload", expires_at: expiresAt, signature: expected },
    });
  });

  test("a revoked grant (401) fails the job before any domain call or consumption", async () => {
    const state = setup();
    await seedCleanFile(state.metadata);
    state.useActors(new HttpJobActorTokenPort({
      auth_base_url: "https://api.example.test/auth",
      internal_api_key: "test-internal-key",
      binding_secret: bindingSecret,
      fetch: async () => Response.json({ error: "invalid_grant" }, { status: 401 }),
    }));
    const job = await startUploadJob(state.platform);
    const error = await runJob(state, job.job_id);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(state.backendCalls).toHaveLength(0);
    expect((await state.metadata.getFile(sourceFileId))?.state).toBe("clean");
    expect(state.failures.map((failure) => failure.reason)).toEqual(["actor_revoked"]);
    expect(await state.inputs.get(job.job_id)).toBeNull();
  });

  test("a revoked response maps to JobActorRevokedError", async () => {
    const port = new HttpJobActorTokenPort({
      auth_base_url: "https://api.example.test/auth",
      internal_api_key: "test-internal-key",
      binding_secret: bindingSecret,
      fetch: async () => new Response(null, { status: 401 }),
    });
    await expect(port.exchange({
      request_id: context.request_id,
      job_id: "25252525-2525-4525-8525-252525252525",
      action_id: "cai.data.06.upload",
      grant_id: grantId,
      subject_id: subjectId,
      club_id: clubId,
      scopes: ["files.write"],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })).rejects.toBeInstanceOf(JobActorRevokedError);
  });
});

describe("K15b production file authorization", () => {
  test("binds to the current snapshot and re-checks the file scope", async () => {
    const authorization = new SnapshotFileAuthorization(async () => snapshotFor());
    await expect(authorization.reauthorize({ context, action: "upload_start" })).resolves.toEqual({ capability_version: "cap-v1" });
    await expect(authorization.reauthorize({ context: { ...context, scopes: ["club.read"] }, action: "upload_start" }))
      .rejects.toMatchObject({ code: "SCOPE_REQUIRED" });
    const foreign = new SnapshotFileAuthorization(async () => snapshotFor(otherClubId));
    await expect(foreign.reauthorize({ context, action: "file_get" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
