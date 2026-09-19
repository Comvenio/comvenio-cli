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
  const contentType = (file.type || "").split(";")[0] ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Vereinslogo muss ein Bild sein (erkannt: ${contentType || "unbekannt"}).`);
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
    body: await file.arrayBuffer(),
  });
  if (!put.ok) throw new Error(`S3-Upload des Logos (PUT) fehlgeschlagen: HTTP ${put.status}`);

  const fin = await client.post<FinalizeOut>("content", `/logos/${presign.file_id}/finalize`, {});
  return {
    file_id: presign.file_id,
    size_bytes: fin.size_bytes ?? file.size,
    filename: basename(path),
  };
}
