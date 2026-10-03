// `comvenio action call cai.data.06.upload --file <path>`: uploads a local file
// through the connector's file tools (K15, Anhang G.3) and hands the clean
// connector file to cai.data.06.upload, whose answer is a background job.
//
// Flow: read + hash locally -> cv_file_upload_start_write -> PUT the bytes to
// the one-time upload URL -> cv_file_upload_complete_write (size, SHA-256,
// type and virus scan) until "clean" -> cai.data.06.upload with the file ID
// -> cv_job_status_read until the job has finished; its `result` names the
// file ID in the club's DataShare (Vereinsablage).
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import {
  MAX_CONNECTOR_FILE_SIZE_BYTES,
  UPLOAD_HANDLE_TTL_SECONDS,
  isPublicErrorCode,
  type ConnectorUploadMime,
  type UploadPurpose,
} from "@comvenio/connector-contracts";

import { PublicCliError } from "../errors.ts";
import { ConnectorClientError, type ConnectorTool } from "../mcp/client.ts";

export const FILE_UPLOAD_ACTION_ID = "cai.data.06.upload";

/** Fields the CLI derives from --file; passing them in --input as well is a contradiction. */
export const FILE_DERIVED_INPUT_FIELDS = ["source_file_id", "filename", "content_type", "expected_size"] as const;

/** Both scopes are needed: files.write for the upload, files.import for the job that consumes it. */
export const FILE_UPLOAD_SCOPES = ["files.import", "files.write"] as const;

/** Club font upload of the design contract (homepage-generator 18). */
export const FONT_UPLOAD_ACTION_ID = "cai.club.15.font_upload";
const CLUB_FONT_MAX_BYTES = 2_097_152;

/**
 * Actions that take a local file via --file. Each names the scopes its job
 * needs, the step shown while it runs and where to look when the outcome is
 * unknown; the upload itself is the same for all.
 */
export const FILE_UPLOAD_ACTIONS: Readonly<Record<string, {
  scopes: readonly string[];
  step: string;
  check: string;
  max_bytes?: number;
}>> = {
  [FILE_UPLOAD_ACTION_ID]: {
    scopes: FILE_UPLOAD_SCOPES,
    step: "Lege die Datei in der Vereinsablage ab …",
    check: "Mit cai.data.01.list prüfen, ob die Datei angekommen ist, statt neu hochzuladen.",
  },
  [FONT_UPLOAD_ACTION_ID]: {
    scopes: ["club.read", "admin.write", ...FILE_UPLOAD_SCOPES],
    step: "Lade die Vereinsschrift hoch und trage sie ein …",
    check: "Mit cai.club.03.settings prüfen, ob die Schrift in design_settings.fonts steht, statt neu hochzuladen.",
    max_bytes: CLUB_FONT_MAX_BYTES,
  },
};

export function isFileUploadAction(actionId: string | undefined): boolean {
  return actionId !== undefined && Object.hasOwn(FILE_UPLOAD_ACTIONS, actionId);
}

const START_TOOL = "cv_file_upload_start_write";
const COMPLETE_TOOL = "cv_file_upload_complete_write";
const JOB_STATUS_TOOL = "cv_job_status_read";
const REQUIRED_TOOLS = [START_TOOL, COMPLETE_TOOL, JOB_STATUS_TOOL] as const;

/**
 * Accepted filename extensions per MIME type. Copy of UPLOAD_EXTENSIONS in
 * apps/mcp-server/src/files/object-inspection.ts (the server rejects a name
 * whose extension does not match the declared type); a test keeps both equal.
 * Table order decides ambiguous extensions (zip, mp4, webm, ogg): the first
 * entry wins, and the server's content check accepts both readings.
 */
export const UPLOAD_EXTENSIONS: Readonly<Record<ConnectorUploadMime, readonly string[]>> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg", "jpe"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "text", "csv", "tsv"],
  "application/json": ["json"],
  "application/zip": ["zip"],
  "application/x-zip-compressed": ["zip"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.oasis.opendocument.text": ["odt"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/html": ["html", "htm"],
  "video/mp4": ["mp4", "m4v"],
  "video/mpeg": ["mpeg", "mpg"],
  "video/webm": ["webm"],
  "video/ogg": ["ogv", "ogg"],
  "video/quicktime": ["mov", "qt"],
  "video/x-msvideo": ["avi"],
  "video/x-matroska": ["mkv"],
  "video/3gpp": ["3gp"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/ogg": ["ogg", "oga", "opus"],
  "audio/wav": ["wav"],
  "audio/webm": ["webm", "weba"],
  "audio/aac": ["aac"],
  "font/ttf": ["ttf"],
  "font/woff2": ["woff2"],
};

/** Extension (lower case, without dot) -> MIME type; the first table entry wins. */
export const EXTENSION_MIME: ReadonlyMap<string, ConnectorUploadMime> = (() => {
  const map = new Map<string, ConnectorUploadMime>();
  for (const [mime, extensions] of Object.entries(UPLOAD_EXTENSIONS) as Array<[ConnectorUploadMime, readonly string[]]>) {
    for (const extension of extensions) if (!map.has(extension)) map.set(extension, mime);
  }
  return map;
})();

/** Poll sequence of the job contract (1, 2, 4, 8, then 15 seconds) with ±20 % jitter. */
export const POLLING_SECONDS = [1, 2, 4, 8, 15] as const;
const POLLING_JITTER = 0.2;
/** Upper bound for following the background job; the upload phase is bounded by the handle's 15 minutes. */
export const JOB_POLL_LIMIT_MS = 15 * 60 * 1_000;

const RETRYABLE_CODES = new Set([
  "AUTH_TEMPORARILY_UNAVAILABLE",
  "RATE_LIMITED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
  // A write tool reports an unanswered request as OUTCOME_UNKNOWN; completing is idempotent.
  "OUTCOME_UNKNOWN",
]);

const REJECTION_TEXT: Record<string, string> = {
  MIME_MISMATCH: "Der Inhalt der Datei passt nicht zu ihrer Endung.",
  SIZE_MISMATCH: "Die übertragene Größe weicht von der angekündigten ab.",
  HASH_MISMATCH: "Die Prüfsumme der übertragenen Datei weicht ab.",
  MALWARE: "Der Virenscan hat Schadsoftware gefunden.",
  ARCHIVE_LIMIT_EXCEEDED: "Das Archiv überschreitet die erlaubten Grenzen (Einträge, Größe oder Tiefe).",
  UNSAFE_ARCHIVE: "Das Archiv enthält unsichere Pfade oder Einträge.",
  EXPIRED: "Der Upload wurde nicht innerhalb von 15 Minuten abgeschlossen und ist verfallen.",
};

const EXPIRY_HINT = "Ein nicht abgeschlossener Upload verfällt nach 15 Minuten; danach denselben Befehl neu starten.";

export type LocalUploadFile = {
  path: string;
  filename: string;
  mime_type: ConnectorUploadMime;
  size_bytes: number;
  sha256: string;
  bytes: Uint8Array;
};

export type UploadConnector = {
  listTools(): Promise<ConnectorTool[]>;
  callTool(name: string, arguments_: Record<string, unknown>): Promise<Record<string, unknown>>;
  callAction(input: {
    action_id: string;
    input: Record<string, unknown>;
    idempotency_key?: string;
  }): Promise<Record<string, unknown>>;
};

export type FileUploadPhase = "upload" | "scan" | "job";

export type FileUploadDependencies = {
  client: UploadConnector;
  /** Scopes of the stored sign-in; checked before any network call. */
  granted_scopes: readonly string[];
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Aborts the run (Ctrl+C); the error names what happens to the upload. */
  signal?: AbortSignal;
  progress?: (phase: FileUploadPhase, message: string) => void;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof ConnectorClientError)) return null;
  const data = object(error.details);
  if (typeof data?.code === "string") return data.code;
  return typeof data?.error === "string" ? data.error.toUpperCase() : null;
}

function retryAfterMs(error: unknown): number | null {
  const data = error instanceof ConnectorClientError ? object(error.details) : null;
  return typeof data?.retry_after_seconds === "number" && data.retry_after_seconds > 0
    ? data.retry_after_seconds * 1_000
    : null;
}

/** MIME type for a filename by its extension, or null for an unknown extension. */
export function mimeForFilename(filename: string): ConnectorUploadMime | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return EXTENSION_MIME.get(filename.slice(dot + 1).toLowerCase()) ?? null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads and checks the local file; every failure here happens before any network call. */
export function readUploadFile(path: string): LocalUploadFile {
  const filename = basename(path);
  const mime = mimeForFilename(filename);
  if (!mime) {
    const dot = filename.lastIndexOf(".");
    const extension = dot > 0 && dot < filename.length - 1 ? `.${filename.slice(dot + 1)}` : "ohne Endung";
    throw new Error(
      `Der Dateityp ${extension} kann nicht hochgeladen werden. Erlaubt sind: `
      + `${[...EXTENSION_MIME.keys()].sort().join(", ")}.`,
    );
  }
  if (filename.length > 240) {
    throw new Error("Der Dateiname ist zu lang (höchstens 240 Zeichen).");
  }
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    throw new Error(`Datei nicht gefunden oder nicht lesbar: ${path}`);
  }
  if (size === 0) throw new Error("Die Datei ist leer.");
  if (size > MAX_CONNECTOR_FILE_SIZE_BYTES) {
    throw new Error(
      `Die Datei ist zu groß: höchstens ${MAX_CONNECTOR_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch (error) {
    throw new Error(`Datei konnte nicht gelesen werden: ${(error as Error).message}`);
  }
  if (bytes.byteLength !== size) {
    throw new Error("Die Datei hat sich beim Lesen verändert.");
  }
  return { path, filename, mime_type: mime, size_bytes: size, sha256: sha256Hex(bytes), bytes };
}

/** Rejects --input fields that --file sets itself. */
export function assertNoFileDerivedFields(input: Record<string, unknown>): void {
  const clashing = FILE_DERIVED_INPUT_FIELDS.filter((field) => Object.hasOwn(input, field));
  if (clashing.length > 0) {
    throw new Error(
      `Mit --file setzt das CLI ${clashing.join(", ")} selbst; diese Felder nicht zusätzlich in --input angeben.`,
    );
  }
}

function purposeFor(contextType: unknown): UploadPurpose {
  if (contextType === "event") return "event_asset";
  if (contextType === "news") return "news_asset";
  return "club_file";
}

/** Delay before poll `attempt` (0-based): 1, 2, 4, 8, then 15 s, each ±20 %. */
export function pollDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = POLLING_SECONDS[Math.min(attempt, POLLING_SECONDS.length - 1)]! * 1_000;
  const jitter = (random() * 2 - 1) * POLLING_JITTER;
  return Math.max(0, Math.round(base * (1 + jitter)));
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function uploadIncomplete(detail: string): PublicCliError {
  return new PublicCliError("UPLOAD_TIMEOUT", detail, { detail: `${detail} ${EXPIRY_HINT}` });
}

function jobUnfinished(
  jobId: string,
  state: string,
  check = "Mit cai.data.01.list prüfen, ob die Datei angekommen ist, statt neu hochzuladen.",
): PublicCliError {
  const detail = `Der Hintergrundauftrag ${jobId} war zuletzt im Zustand ${state}. Die Datei ist bereits übergeben: ${check}`;
  return new PublicCliError("OUTCOME_UNKNOWN", detail, { detail });
}

/** The file the job stored in the club's DataShare (Vereinsablage), as the job status reports it. */
export type DataShareFileResult = {
  kind: "datashare_file";
  file_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

/** Reads the job's `result`; anything but a complete DataShare file reference is null. */
export function dataShareFileResult(job: Record<string, unknown>): DataShareFileResult | null {
  const result = object(job.result);
  if (
    result?.kind !== "datashare_file"
    || typeof result.file_id !== "string"
    || typeof result.filename !== "string"
    || typeof result.content_type !== "string"
    || typeof result.size_bytes !== "number"
  ) {
    return null;
  }
  return {
    kind: "datashare_file",
    file_id: result.file_id,
    filename: result.filename,
    content_type: result.content_type,
    size_bytes: result.size_bytes,
  };
}

/** The club font a finished cai.club.15.font_upload job reports, or null. */
export function clubFontResult(job: Record<string, unknown>): Record<string, unknown> | null {
  const result = object(job.result);
  if (
    result?.kind !== "club_font"
    || typeof result.font_id !== "string"
    || typeof result.family !== "string"
    || (result.format !== "ttf" && result.format !== "woff2")
    || typeof result.size_bytes !== "number"
  ) {
    return null;
  }
  return { kind: "club_font", font_id: result.font_id, family: result.family, format: result.format, size_bytes: result.size_bytes };
}

/** Human-readable summary of a finished upload (the non-JSON output). */
export function formatFileUploadResult(result: Record<string, unknown>): string {
  const file = object(result.file) ?? {};
  const job = object(result.job) ?? {};
  const stored = object(result.result);
  if (result.action_id === FONT_UPLOAD_ACTION_ID) {
    return [
      `Hochgeladen: ${String(file.filename)} (${String(file.content_type)}, ${String(file.size_bytes)} Bytes)`,
      `Hintergrundauftrag: ${String(job.job_id)} — ${String(job.state)}`,
      stored
        ? `Vereinsschrift: font_id ${String(stored.font_id)} — ${String(stored.family)} (${String(stored.format)}); `
          + "in tokens.type mit source verein verwenden (cai.club.05.design)"
        : "Vereinsschrift: Der Server hat keine font_id gemeldet; mit cai.club.03.settings nachsehen.",
      `Idempotenzschlüssel: ${String(result.idempotency_key)}`,
    ].join("\n");
  }
  return [
    `Hochgeladen: ${String(file.filename)} (${String(file.content_type)}, ${String(file.size_bytes)} Bytes)`,
    `Hintergrundauftrag: ${String(job.job_id)} — ${String(job.state)}`,
    stored
      ? `Vereinsablage: Datei-ID ${String(stored.file_id)} — ${String(stored.filename)} `
        + `(${String(stored.content_type)}, ${String(stored.size_bytes)} Bytes)`
      : "Vereinsablage: Der Server hat keine Datei-ID gemeldet; mit cai.data.01.list nachsehen.",
    `Idempotenzschlüssel: ${String(result.idempotency_key)}`,
  ].join("\n");
}

/**
 * Runs the whole upload. Returns the finished job, the DataShare file it
 * reports (`result`) and the local file facts; throws a PublicCliError (or the connector's own error) otherwise.
 */
export async function runFileUpload(
  request: {
    path: string;
    input: Record<string, unknown>;
    idempotency_key?: string;
    /** One of FILE_UPLOAD_ACTIONS; cai.data.06.upload when left out. */
    action_id?: string;
  },
  deps: FileUploadDependencies,
): Promise<Record<string, unknown>> {
  const actionId = request.action_id ?? FILE_UPLOAD_ACTION_ID;
  const target = FILE_UPLOAD_ACTIONS[actionId];
  if (!target) throw new Error(`--file ist für ${actionId} nicht vorgesehen.`);
  const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const signal = deps.signal;
  const progress = deps.progress ?? (() => undefined);

  // Local checks first: nothing leaves the machine for a request that cannot succeed.
  assertNoFileDerivedFields(request.input);
  const file = readUploadFile(request.path);
  if (target.max_bytes !== undefined && file.size_bytes > target.max_bytes) {
    throw new PublicCliError("VALIDATION_FAILED", `Die Datei ist zu groß: höchstens ${target.max_bytes / (1024 * 1024)} MB.`, {
      detail: `${actionId} nimmt höchstens ${target.max_bytes} Bytes an.`,
    });
  }
  const missingScopes = target.scopes.filter((scope) => !deps.granted_scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new PublicCliError("SCOPE_REQUIRED", "Für Datei-Uploads fehlen Scopes.", {
      required_scopes: missingScopes,
    });
  }

  const tools = new Set((await deps.client.listTools()).map((tool) => tool.name));
  if (REQUIRED_TOOLS.some((name) => !tools.has(name))) {
    throw new PublicCliError(
      "UPLOAD_NOT_ENABLED",
      "Datei-Upload ist in diesem Verein/auf diesem Server noch nicht eingeschaltet.",
    );
  }

  const aborted = (phase: FileUploadPhase, jobId?: string, state?: string): PublicCliError =>
    phase === "job" && jobId
      ? jobUnfinished(jobId, state ?? "unbekannt", target.check)
      : uploadIncomplete("Der Upload wurde abgebrochen.");
  const wait = async (ms: number, phase: FileUploadPhase, jobId?: string, state?: string) => {
    try {
      await sleep(ms, signal);
    } catch {
      throw aborted(phase, jobId, state);
    }
  };

  // 1. Start: one-time HTTPS upload URL with the exact headers to send.
  progress("upload", `Lade ${file.filename} hoch (${file.size_bytes} Bytes) …`);
  const started = await deps.client.callTool(START_TOOL, {
    filename: file.filename,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    purpose: purposeFor(request.input.context_type),
  });
  const uploadId = typeof started.upload_id === "string" ? started.upload_id : null;
  const uploadUrl = typeof started.upload_url === "string" ? started.upload_url : null;
  const headers = object(started.required_headers);
  if (!uploadId || !uploadUrl || !headers || new URL(uploadUrl).protocol !== "https:") {
    throw new PublicCliError("UPSTREAM_UNAVAILABLE", "Der Upload wurde nicht gültig vorbereitet.");
  }
  const expiresAt = typeof started.expires_at === "string" ? Date.parse(started.expires_at) : Number.NaN;
  const uploadDeadline = Math.min(
    Number.isFinite(expiresAt) ? expiresAt : Number.POSITIVE_INFINITY,
    now() + UPLOAD_HANDLE_TTL_SECONDS * 1_000,
  );

  // 2. PUT exactly the required headers; the URL is signed for them.
  if (signal?.aborted) throw aborted("upload");
  let put: Response;
  try {
    put = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string")),
      body: file.bytes,
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(Math.max(1, uploadDeadline - now())),
      ]),
    });
  } catch {
    throw uploadIncomplete(signal?.aborted
      ? "Der Upload wurde abgebrochen."
      : "Die Übertragung der Datei ist abgebrochen.");
  }
  await put.body?.cancel().catch(() => undefined);
  if (!put.ok) {
    throw uploadIncomplete(`Die Übertragung der Datei wurde abgelehnt (HTTP ${put.status}).`);
  }

  // 3. Complete until clean; completing is idempotent and doubles as the status poll.
  progress("scan", "Prüfe Datei (Größe, Prüfsumme, Dateityp, Virenscan) …");
  let fileId: string | null = null;
  for (let attempt = 0; ; attempt += 1) {
    let handle: Record<string, unknown> | null = null;
    let delay: number | null = null;
    try {
      handle = await deps.client.callTool(COMPLETE_TOOL, {
        upload_id: uploadId,
        completion: { size_bytes: file.size_bytes, sha256: file.sha256 },
      });
    } catch (error) {
      if (!RETRYABLE_CODES.has(errorCode(error) ?? "")) throw error;
      delay = retryAfterMs(error);
    }
    if (handle) {
      const state = handle.state;
      if (state === "clean" && typeof handle.file_id === "string") {
        fileId = handle.file_id;
        break;
      }
      if (state === "rejected" || state === "expired") {
        const code = typeof handle.rejection_code === "string" ? handle.rejection_code : "UNBEKANNT";
        if (state === "expired" || code === "EXPIRED") throw uploadIncomplete(REJECTION_TEXT.EXPIRED!);
        const text = REJECTION_TEXT[code] ?? "Die Datei wurde abgelehnt.";
        throw new PublicCliError("UPLOAD_REJECTED", `Ablehnungsgrund ${code}`, {
          detail: `Ablehnungsgrund ${code}: ${text}`,
        });
      }
      if (state === "consumed") {
        throw new PublicCliError("CONFLICT", "Die Datei wurde bereits verwendet.");
      }
      progress("scan", "Die Prüfung läuft noch …");
    }
    const pause = Math.max(delay ?? 0, pollDelayMs(attempt, random));
    if (now() + pause >= uploadDeadline) {
      throw uploadIncomplete("Die Prüfung der Datei ist nicht rechtzeitig fertig geworden.");
    }
    await wait(pause, "scan");
  }

  // 4. Hand the clean file to the action; its answer is a job handle.
  const idempotencyKey = request.idempotency_key ?? randomUUID();
  progress("job", target.step);
  const call = await deps.client.callAction({
    action_id: actionId,
    input: {
      ...request.input,
      source_file_id: fileId,
      filename: file.filename,
      content_type: file.mime_type,
      expected_size: file.size_bytes,
    },
    idempotency_key: idempotencyKey,
  });
  let job = object(call.result) ?? call;
  const jobId = typeof job.job_id === "string" ? job.job_id : null;
  if (!jobId) {
    const detail = `Die Antwort enthält keinen Hintergrundauftrag. ${target.check}`;
    throw new PublicCliError("OUTCOME_UNKNOWN", detail, { detail });
  }

  // 5. Follow the job with the contract's poll sequence.
  const jobDeadline = now() + JOB_POLL_LIMIT_MS;
  for (let attempt = 0; ; attempt += 1) {
    const state = typeof job.state === "string" ? job.state : "unbekannt";
    if (state === "succeeded") break;
    if (state === "failed" || state === "cancelled" || state === "expired") {
      const reported = job.error_code;
      const code = isPublicErrorCode(reported) ? reported : "UNKNOWN_ERROR";
      throw new PublicCliError(code, `Hintergrundauftrag ${state}`, {
        detail: `Der Hintergrundauftrag ${jobId} endete im Zustand ${state}.`,
      });
    }
    const pause = pollDelayMs(attempt, random);
    if (now() + pause >= jobDeadline) throw jobUnfinished(jobId, state, target.check);
    await wait(pause, "job", jobId, state);
    try {
      job = await deps.client.callTool(JOB_STATUS_TOOL, { job_id: jobId });
    } catch (error) {
      if (!RETRYABLE_CODES.has(errorCode(error) ?? "")) throw error;
    }
  }

  return {
    action_id: actionId,
    status: "succeeded",
    job,
    // The stored file (DataShare file or club font); null when the server does not report it.
    result: actionId === FONT_UPLOAD_ACTION_ID ? clubFontResult(job) : dataShareFileResult(job),
    file: {
      source_file_id: fileId,
      filename: file.filename,
      content_type: file.mime_type,
      size_bytes: file.size_bytes,
      sha256: file.sha256,
    },
    idempotency_key: idempotencyKey,
  };
}
