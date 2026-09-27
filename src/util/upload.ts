import { basename } from "node:path";
import type { ComvenioClient } from "../http.ts";

export type UploadClubFileInput = {
  client: ComvenioClient;
  clubId: string;
  path: string;
  contextType: string;
  contextId?: string;
  subContextId?: string;
  departmentId?: string;
  label?: string;
  isPublic?: boolean;
};

export type UploadClubFileResult = {
  file_id: string;
  visibility: "public" | "private";
  size_bytes?: number;
  filename: string;
};

type PresignUploadOut = {
  file_id?: string;
  upload_url?: string;
  headers?: Record<string, string>;
};
type FinalizeOut = { ok?: boolean; size_bytes?: number };

export async function uploadClubFile({
  client,
  clubId,
  path,
  contextType,
  contextId,
  subContextId,
  departmentId,
  label,
  isPublic,
}: UploadClubFileInput): Promise<UploadClubFileResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Datei nicht gefunden: ${path}`);
  const expectedSize = file.size;
  if (expectedSize <= 0) throw new Error(`Datei ist leer: ${path}`);
  // K6 (D-10): must match content-service MAX_FILE_UPLOAD_BYTES code default (200 MB)
  const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
  if (expectedSize > MAX_UPLOAD_BYTES) throw new Error("Datei > 200 MB (Upload-Limit).");

  const contentType = file.type || "application/octet-stream";
  const visibility = isPublic ? "public" : "private";
  const presign = await client.post<PresignUploadOut>("content", "/files/presign-upload", {
    club_id: clubId,
    club_department_id: departmentId,
    filename: basename(path),
    content_type: contentType,
    expected_size: expectedSize,
    visibility,
    context_type: contextType,
    context_id: contextId,
    sub_context_id: subContextId,
    context_label: label,
  });

  if (!presign.upload_url || !presign.file_id) {
    throw new Error("presign-upload lieferte keine upload_url/file_id.");
  }

  const put = await fetch(presign.upload_url, {
    method: "PUT",
    headers: presign.headers ?? { "Content-Type": contentType },
    // Bun standalone-exe bug (1.3.13, Windows): streaming a Bun.file body through fetch
    // segfaults in compiled executables (works under `bun run`). Reading into memory is
    // fine here — uploads are capped at 200 MB (MAX_UPLOAD_BYTES).
    body: await file.arrayBuffer(),
  });
  if (!put.ok) throw new Error(`S3-Upload (PUT) fehlgeschlagen: HTTP ${put.status}`);

  const fin = await client.post<FinalizeOut>("content", `/files/${presign.file_id}/finalize`, {});
  return {
    file_id: presign.file_id,
    visibility,
    size_bytes: fin.size_bytes ?? expectedSize,
    filename: basename(path),
  };
}

export type UploadClubLogoInput = {
  client: ComvenioClient;
  clubId: string;
  path: string;
};

export type UploadClubLogoResult = {
  file_id: string;
  size_bytes?: number;
  filename: string;
};

// The logo is loaded by every page header and share preview; the content-service
// logo route has no size limit of its own, so the CLI enforces one.
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;

/** Image type from the file's first bytes; the extension alone proves nothing. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return isSvgDocument(bytes) ? "image/svg+xml" : null;
}

/**
 * The root element is <svg> — after an optional BOM, XML declaration,
 * processing instructions, comments and a doctype, however long those are.
 * HTML with an embedded <svg> is not an SVG document.
 */
function isSvgDocument(bytes: Uint8Array): boolean {
  let text = new TextDecoder().decode(bytes.slice(0, 256 * 1024)).replace(/^﻿/, "");
  for (;;) {
    text = text.trimStart();
    const skip = [/^<\?[\s\S]*?\?>/, /^<!--[\s\S]*?-->/, /^<!doctype[^>]*>/i]
      .map((re) => re.exec(text)?.[0].length ?? 0)
      .find((n) => n > 0);
    if (!skip) break;
    text = text.slice(skip);
  }
  return /^<svg[\s>/]/i.test(text);
}

// Club logos have their own content-service route (/logos). The public logo
// lookup only considers objects under .../public/logos/, so a regular
// DataShare upload with context "club" never replaces the logo.
export async function uploadClubLogo({
  client,
  clubId,
  path,
}: UploadClubLogoInput): Promise<UploadClubLogoResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Datei nicht gefunden: ${path}`);
  if (file.size <= 0) throw new Error(`Datei ist leer: ${path}`);
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error(
      `Vereinslogo ist zu groß (${Math.ceil(file.size / 1024 / 1024)} MB, erlaubt ${MAX_LOGO_BYTES / 1024 / 1024} MB).`,
    );
  }
  // Size is checked first, so reading into memory is bounded.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new Error("Vereinslogo muss ein Bild sein (PNG, JPEG, GIF, WebP oder SVG); der Dateiinhalt passt zu keinem davon.");
  }

  const query = `?filename=${encodeURIComponent(basename(path))}&content_type=${encodeURIComponent(contentType)}`;
  const presign = await client.post<PresignUploadOut>(
    "content",
    `/logos/club/${encodeURIComponent(clubId)}/presign-upload${query}`,
    {},
  );
  if (!presign.upload_url || !presign.file_id) {
    throw new Error("Logo-presign-upload lieferte keine upload_url/file_id.");
  }

  const put = await fetch(presign.upload_url, {
    method: "PUT",
    headers: presign.headers ?? { "Content-Type": contentType },
    // Same standalone-exe constraint as uploadClubFile: send bytes, not a stream.
    body: bytes,
  });
  if (!put.ok) throw new Error(`S3-Upload des Logos (PUT) fehlgeschlagen: HTTP ${put.status}`);

  const fin = await client.post<FinalizeOut>("content", `/logos/${presign.file_id}/finalize`, {});
  return {
    file_id: presign.file_id,
    size_bytes: fin.size_bytes ?? file.size,
    filename: basename(path),
  };
}

// ── Club fonts (Lastenheft homepage-generator 18, K18) ──────────────────────

export const MAX_FONT_BYTES = 2 * 1024 * 1024;
/** At most two club fonts per club (club-service MAX_CLUB_FONTS). */
export const MAX_CLUB_FONTS = 2;

export type ClubFontEntry = { id: string; family: string; format: string; lizenz: string };

export type UploadClubFontResult = { font_id: string; family: string; format: string; size_bytes: number };

/** Font format from the file's first bytes, the same rule as the content-service. */
export function sniffFontFormat(bytes: Uint8Array): "woff2" | "ttf" | null {
  const head = String.fromCharCode(...bytes.slice(0, 4));
  if (head === "wOF2") return "woff2";
  if (head === "\x00\x01\x00\x00" || head === "true") return "ttf";
  return null;
}

/**
 * The registry after adding a font: a font with the same family replaces the
 * old entry, otherwise it is appended; more than MAX_CLUB_FONTS is refused
 * before anything is written.
 */
export function registerClubFont(existing: unknown, font: ClubFontEntry): ClubFontEntry[] {
  const current = Array.isArray(existing)
    ? existing.filter((f): f is ClubFontEntry => !!f && typeof f === "object" && typeof (f as ClubFontEntry).id === "string")
    : [];
  const others = current.filter((f) => f.family !== font.family);
  if (others.length >= MAX_CLUB_FONTS) {
    throw new Error(
      `Der Verein hat schon ${others.length} Schriften (${others.map((f) => f.family).join(", ")}); erlaubt sind ${MAX_CLUB_FONTS}.`,
    );
  }
  return [...others, font];
}

export type ClubFontReport = {
  fonts: { id: string; family: string; format: string }[];
  roles: { role: string; family: string; source: string; font_id?: string }[];
  /** Roles whose font_id is not in the registry: web and app fall back to the default family. */
  missing: { role: string; font_id: string }[];
};

/** Registered fonts, font roles from tokens.type and dangling font_id references. */
export function describeClubFonts(designSettings: unknown): ClubFontReport {
  const ds = designSettings && typeof designSettings === "object" ? (designSettings as Record<string, unknown>) : {};
  const fonts = (Array.isArray(ds.fonts) ? ds.fonts : [])
    .filter((f): f is ClubFontEntry => !!f && typeof f === "object" && typeof (f as ClubFontEntry).id === "string")
    .map(({ id, family, format }) => ({ id, family, format }));
  const tokens = ds.tokens && typeof ds.tokens === "object" ? (ds.tokens as Record<string, unknown>) : {};
  const type = tokens.type && typeof tokens.type === "object" ? (tokens.type as Record<string, unknown>) : {};
  const roles: ClubFontReport["roles"] = [];
  const missing: ClubFontReport["missing"] = [];
  const known = new Set(fonts.map((f) => f.id));
  for (const role of ["heading", "body"]) {
    const spec = type[role];
    if (!spec || typeof spec !== "object") continue;
    const { family, source, font_id } = spec as Record<string, unknown>;
    const entry = { role, family: String(family ?? ""), source: String(source ?? "") };
    roles.push(typeof font_id === "string" ? { ...entry, font_id } : entry);
    if (source === "verein" && typeof font_id === "string" && !known.has(font_id)) missing.push({ role, font_id });
  }
  return { fonts, roles, missing };
}

export async function uploadClubFont({
  client,
  clubId,
  path,
  family,
  lizenz,
}: {
  client: ComvenioClient;
  clubId: string;
  path: string;
  family: string;
  lizenz: string;
}): Promise<UploadClubFontResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Datei nicht gefunden: ${path}`);
  if (file.size <= 0) throw new Error(`Datei ist leer: ${path}`);
  if (file.size > MAX_FONT_BYTES) {
    throw new Error(`Schriftdatei ist zu groß (${Math.ceil(file.size / 1024)} KB, erlaubt ${MAX_FONT_BYTES / 1024 / 1024} MB).`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffFontFormat(bytes)) {
    throw new Error("Schriftdatei muss WOFF2 oder TrueType (TTF) sein; der Dateiinhalt passt zu keinem davon.");
  }
  const form = new FormData();
  form.append("family", family);
  form.append("lizenz", lizenz);
  form.append("file", new Blob([bytes]), basename(path));
  return await client.postForm<UploadClubFontResult>("content", `/fonts/club/${encodeURIComponent(clubId)}/upload`, form);
}
