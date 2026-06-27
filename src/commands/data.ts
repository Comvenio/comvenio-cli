import type { CAC } from "cac";
import { basename } from "node:path";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";

// K12 — `comvenio data <action>`: load, list, provide club files via the
// content-service (the existing "DataShare" domain). RBAC server-side: the CLI
// only carries the token; the server checks read_files/write_files (upload is
// context-aware: event→manage_events, certificate→manage_honors). ANALYSE is the
// AGENT itself (load raw data, evaluate) — no analyze endpoint (analog "Generieren
// = du"). Structured CSV/Excel export = K13 (`data export`). gateway key "content".
//
// Verified against content-service code (2026-06-26):
//   list:     GET  /content/files/by-context/{club_id}/{context_type}/{context_id}  (PATH params)
//   show:     GET  /content/files/{file_id}
//   download: POST /content/files/download-url {file_id} -> { url, expires_in } -> fetch url (direct S3)
//   upload:   3-step presign — POST /content/files/presign-upload -> PUT upload_url (S3) -> POST /content/files/{id}/finalize
//   papers:   GET  /content/papers/context/{club_id}/{context_type}/{context_id}  OR  /content/papers/club/{club_id}

type FileEntryRead = {
  id?: string;
  filename?: string; // content-service field is `filename` (NOT original_filename)
  context_type?: string;
  context_label?: string;
  visibility?: string;
  size_bytes?: number;
  content_type?: string;
  [key: string]: unknown;
};
type DownloadURLOut = { url?: string; expires_in?: number };
type PresignUploadOut = {
  file_id?: string;
  object_key?: string;
  upload_url?: string;
  headers?: Record<string, string>;
};
type FinalizeOut = { ok?: boolean; etag?: string; size_bytes?: number };
type PaperRead = { id?: string; file_id?: string; document_type?: string; title?: string; [k: string]: unknown };

type DataOpts = {
  json?: boolean;
  club?: string;
  context?: string;
  contextId?: string;
  out?: string;
  label?: string;
  public?: boolean;
  type?: string;
  format?: string;
};

export function registerDataCommands(cli: CAC): void {
  cli
    .command(
      "data <action> [arg]",
      "Vereins-Dateien: list | show | download | upload | papers | export (K13)",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--context <type>", "context_type (list/upload/papers): event|paper|certificate|...")
    .option("--context-id <id>", "context_id (Pflicht bei list; Zuordnung bei upload/papers)")
    .option("--out <path>", "Zielpfad (download)")
    .option("--label <bucket>", "context_label/Bucket (upload), z.B. title_picture|flyer|gallery")
    .option("--public", "Sichtbarkeit public (upload; Default private)")
    .option("--type <doc>", "document_type-Filter (papers): protokoll|flyer|bericht|...")
    .option("--format <fmt>", "Export-Format csv|xlsx (data export; Default csv)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, arg: string | undefined, opts: DataOpts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          // by-context needs ALL THREE as PATH params (verified) — context_id is mandatory.
          if (!opts.context) throw new Error("data list benoetigt --context <type>.");
          if (!opts.contextId) {
            throw new Error(
              "data list benoetigt --context-id <id> (der by-context-Endpoint verlangt club_id + context_type + context_id).",
            );
          }
          const files = await client.get<FileEntryRead[]>(
            "content",
            `/files/by-context/${clubId}/${opts.context}/${opts.contextId}`,
          );
          output(files, opts.json, () =>
            Array.isArray(files) && files.length
              ? renderTable(files, [
                  { header: "Datei", width: 34, get: (f) => String(f.filename ?? "—") },
                  { header: "Label", width: 14, get: (f) => String(f.context_label ?? "—") },
                  { header: "Sicht", width: 8, get: (f) => String(f.visibility ?? "—") },
                  { header: "Bytes", width: 9, get: (f) => String(f.size_bytes ?? "") },
                ])
              : "Keine Dateien.",
          );
          break;
        }

        case "show": {
          if (!arg) throw new Error("data show <file-id> benoetigt eine Datei-ID.");
          const file = await client.get<FileEntryRead>("content", `/files/${arg}`);
          output(file, opts.json, () =>
            `${file.filename ?? "—"} (${file.visibility ?? "?"}, ${file.size_bytes ?? "?"} Bytes, ${file.content_type ?? "?"})`,
          );
          break;
        }

        case "download": {
          if (!arg) throw new Error("data download <file-id> benoetigt eine Datei-ID.");
          // 2-step: download-url -> presigned S3 URL -> fetch directly (not via gateway).
          const res = await client.post<DownloadURLOut>("content", `/files/download-url`, {
            file_id: arg,
          });
          if (!res.url) throw new Error("Keine Download-URL vom content-service erhalten.");
          const bytes = await fetch(res.url).then((r) => {
            if (!r.ok) throw new Error(`S3-Download fehlgeschlagen: HTTP ${r.status}`);
            return r.arrayBuffer();
          });
          const out = opts.out ?? `./${arg}`;
          await Bun.write(out, bytes);
          output({ file_id: arg, out, size_bytes: bytes.byteLength }, opts.json, () =>
            `Heruntergeladen: ${out} (${bytes.byteLength} Bytes)`,
          );
          break;
        }

        case "upload": {
          if (!arg) throw new Error("data upload <pfad> benoetigt eine lokale Datei.");
          if (!opts.context) throw new Error("data upload benoetigt --context <type>.");
          const file = Bun.file(arg);
          if (!(await file.exists())) throw new Error(`Datei nicht gefunden: ${arg}`);
          const expectedSize = file.size;
          if (expectedSize <= 0) throw new Error(`Datei ist leer: ${arg}`);
          if (expectedSize > 34 * 1024 * 1024) throw new Error("Datei > 34 MB (Upload-Limit).");
          const contentType = file.type || "application/octet-stream";

          // Step 1: reserve + presign.
          const presign = await client.post<PresignUploadOut>("content", `/files/presign-upload`, {
            club_id: clubId,
            filename: basename(arg),
            content_type: contentType,
            expected_size: expectedSize,
            visibility: opts.public ? "public" : "private",
            context_type: opts.context,
            context_id: opts.contextId,
            context_label: opts.label,
          });
          if (!presign.upload_url || !presign.file_id) {
            throw new Error("presign-upload lieferte keine upload_url/file_id.");
          }
          // Step 2: PUT the bytes DIRECTLY to S3 with the returned headers (Content-Type).
          const put = await fetch(presign.upload_url, {
            method: "PUT",
            headers: presign.headers ?? { "Content-Type": contentType },
            body: file,
          });
          if (!put.ok) throw new Error(`S3-Upload (PUT) fehlgeschlagen: HTTP ${put.status}`);
          // Step 3: finalize (server reads ETag+size from S3, activates the FileEntry).
          const fin = await client.post<FinalizeOut>(
            "content",
            `/files/${presign.file_id}/finalize`,
            {},
          );
          output(
            { file_id: presign.file_id, visibility: opts.public ? "public" : "private", ...fin },
            opts.json,
            () =>
              `Bereitgestellt: ${basename(arg)} (${fin.size_bytes ?? expectedSize} Bytes, ${opts.public ? "public" : "private"}) — file_id ${presign.file_id}`,
          );
          break;
        }

        case "papers": {
          // Context-scoped if both given, else club-wide. Permission: manage_news (server-side).
          const path =
            opts.context && opts.contextId
              ? `/papers/context/${clubId}/${opts.context}/${opts.contextId}`
              : `/papers/club/${clubId}`;
          const rows = await client.get<PaperRead[]>("content", path);
          const filtered =
            opts.type && Array.isArray(rows)
              ? rows.filter((r) => String(r.document_type ?? "").toLowerCase() === opts.type!.toLowerCase())
              : rows;
          output(filtered, opts.json, () =>
            Array.isArray(filtered) && filtered.length
              ? renderTable(filtered, [
                  { header: "Titel", width: 30, get: (p) => String(p.title ?? "—") },
                  { header: "Typ", width: 14, get: (p) => String(p.document_type ?? "—") },
                  { header: "file_id", width: 38, get: (p) => String(p.file_id ?? "—") },
                ])
              : "Keine Dokumente.",
          );
          break;
        }

        case "export": {
          // K13 — strukturierter CSV/XLSX-Export (read-only Backend-Endpoints).
          if (arg !== "members" && arg !== "bookings") {
            throw new Error("data export <members|bookings> — nur diese beiden Entitaeten.");
          }
          const fmt = opts.format === "xlsx" ? "xlsx" : "csv";
          const { svc, p } =
            arg === "members"
              ? { svc: "member", p: `/members/export/${clubId}?format=${fmt}` }
              : { svc: "object", p: `/object-reservations/export/${clubId}?format=${fmt}` };
          // Export liefert Binaer (xlsx) — der JSON-Client wuerde die Bytes zerstoeren,
          // daher roher fetch mit Bearer-Header.
          const url = `${state.gatewayBaseUrl}/${svc}${p}`;
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
          if (!resp.ok) {
            throw new Error(
              `Export fehlgeschlagen: HTTP ${resp.status} ${(await resp.text()).slice(0, 160)}`,
            );
          }
          const bytes = await resp.arrayBuffer();
          const out = opts.out ?? `./${arg}-export.${fmt}`;
          await Bun.write(out, bytes);
          output({ entity: arg, format: fmt, out, size_bytes: bytes.byteLength }, opts.json, () =>
            `Export ${arg} (${fmt}): ${out} (${bytes.byteLength} Bytes)`,
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, download, upload, papers, export`,
          );
      }
    });
}
