import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 query presigning for S3-compatible storage
 * (UNSIGNED-PAYLOAD). Unlike Bun.S3Client.presign it signs arbitrary request
 * headers, so a presigned PUT can bind content-length (the declared size) and
 * content-type; the storage rejects a request whose header values differ.
 */

export interface SigV4PresignInput {
  method: "GET" | "PUT";
  /** Object URL without query string; its path must already be RFC 3986 encoded (see encodeS3Path). */
  url: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  expires_in_seconds: number;
  now: Date;
  /** Headers the client must send with exactly these values; host is always signed. */
  signed_headers?: Readonly<Record<string, string>>;
  /** Optional session token (temporary credentials), sent as X-Amz-Security-Token. */
  session_token?: string;
}

const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

/** RFC 3986 encoding as required by SigV4: only unreserved characters stay literal. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Encodes every segment of an S3 object path; slashes separate segments and stay literal. */
export function encodeS3Path(segments: readonly string[]): string {
  return `/${segments.flatMap((segment) => segment.split("/")).map(uriEncode).join("/")}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function amzDate(now: Date): { date: string; stamp: string } {
  const stamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
  return { date: stamp.slice(0, 8), stamp };
}

function canonicalHeaderValue(value: string): string {
  if (/[\r\n]/u.test(value)) throw new Error("Signed header values must not contain line breaks.");
  return value.trim().replace(/\s+/gu, " ");
}

export function presignSigV4(input: SigV4PresignInput): string {
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) {
    throw new Error("The presign URL must be a plain HTTPS object URL.");
  }
  if (!Number.isInteger(input.expires_in_seconds) || input.expires_in_seconds < 1 || input.expires_in_seconds > MAX_PRESIGN_SECONDS) {
    throw new Error("The presign lifetime is invalid.");
  }
  const { date, stamp } = amzDate(input.now);
  const scope = `${date}/${input.region}/s3/aws4_request`;

  const headers = new Map<string, string>([["host", url.host]]);
  for (const [name, value] of Object.entries(input.signed_headers ?? {})) {
    const key = name.toLowerCase();
    if (headers.has(key)) throw new Error("A signed header is given twice.");
    headers.set(key, canonicalHeaderValue(value));
  }
  const headerNames = [...headers.keys()].sort();
  const signedHeaders = headerNames.join(";");

  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.access_key_id}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(input.expires_in_seconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  if (input.session_token) query.push(["X-Amz-Security-Token", input.session_token]);
  const canonicalQuery = query
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery,
    headerNames.map((name) => `${name}:${headers.get(name)}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secret_access_key}`, date), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
