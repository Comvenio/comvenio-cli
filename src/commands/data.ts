import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import { uploadClubFile } from "../util/upload.ts";
import { cleanupOptimizedVideo, formatMb, isVideoFile, optimizeVideoForWeb } from "../util/optimizeVideo.ts";

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
type PaperRead = { id?: string; file_id?: string; document_type?: string; title?: string; [k: string]: unknown };

type DataOpts = {
  json?: boolean;
  club?: string;
  context?: string;
  contextId?: string;
  subContextId?: string;
  out?: string;
  label?: string;
  public?: boolean;
  type?: string;
  format?: string;
  department?: string;
  folder?: string;
  parent?: string;
  name?: string;
  query?: string;
  visibility?: string;
  file?: string;
  hard?: boolean;
  recursive?: boolean;
  includeDeleted?: boolean;
  protected?: string;
  areaId?: string;
  areaIds?: string;
  optimizeVideo?: boolean;
};

// data update: CLI value "none" clears a field (sends explicit null to the PATCH)
function contextPatchValue(v: string): string | null {
  return v === "none" ? null : v;
}

function nullableFolder(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === "root" || v === "none" ? null : v;
}

function boolValue(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} erwartet true oder false.`);
}

function query(values: Record<string, string | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function fileBody(opts: DataOpts, command: string): Record<string, unknown> {
  if (!opts.file) throw new Error(`${command} benoetigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(opts.file);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: JSON-Payload muss ein Objekt sein.`);
  }
  return body as Record<string, unknown>;
}

export function registerDataCommands(cli: CAC): void {
  cli
    .command(
      "data <action> [arg]",
      "DataShare: Dateien, Ordner, Suche, Papierkorb, Papers und Export",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--context <type>", "context_type (list/upload/papers): event|paper|certificate|...")
    .option("--context-id <id>", "context_id (Pflicht bei list; Zuordnung bei upload/papers/update; 'none' loescht bei update)")
    .option("--sub-context-id <id>", "sub_context_id (upload/update, z.B. event_area_id; 'none' loescht bei update)")
    .option("--out <path>", "Zielpfad (download)")
    .option("--label <bucket>", "context_label/Bucket (upload/update), z.B. title_picture|flyer|gallery; 'none' loescht bei update")
    .option("--public", "Sichtbarkeit public (upload; Default private)")
    .option(
      "--optimize-video",
      "upload: Video vor dem Hochladen automatisch fuers mobile Autoplay optimieren (ffmpeg: H.264 main/4.0, max. 1280px, kein Audio, faststart)",
    )
    .option("--type <doc>", "document_type-Filter (papers): protokoll|flyer|bericht|...")
    .option("--format <fmt>", "Export-Format csv|xlsx (data export; Default csv)")
    .option("--department <id>", "Abteilungs-ID fuer Ordner/Datei-Scope")
    .option("--folder <id>", "Ordner-ID; root/none verschiebt in den Root")
    .option("--parent <id>", "Parent-Ordner; root/none fuer den Root")
    .option("--name <name>", "Ordnername fuer folder-create/folder-rename")
    .option("--query <text>", "Suchtext fuer search")
    .option("--visibility <v>", "Dateisichtbarkeit: public|private")
    .option("--file <path>", "Komplexer JSON-Body, z.B. fuer paper-add/paper-update")
    .option("--hard", "Datei physisch und endgueltig loeschen")
    .option("--no-recursive", "Ordner nicht rekursiv loeschen/wiederherstellen")
    .option("--include-deleted", "Geloeschte Dateien/Ordner mitlisten")
    .option("--protected <bool>", "Ordnerschutz true|false")
    .option("--area-id <id>", "Event-Area-ID fuer area-share-remove")
    .option("--area-ids <ids>", "Kommagetrennte Event-Area-IDs fuer Area-Media/Sharing")
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
            `/files/by-context/${clubId}/${opts.context}/${opts.contextId}${query({
              include_deleted: opts.includeDeleted,
              sub_context_id: opts.subContextId,
            })}`,
          );
          output(files, opts.json, () =>
            Array.isArray(files) && files.length
              ? renderTable(files, [
                  // file_id first: it is the UUID the news flow needs
                  // (data-comvenio-file-id / --cover) — copy-paste ready.
                  { header: "file_id", width: 38, get: (f) => String(f.id ?? "—") },
                  { header: "Datei", width: 30, get: (f) => String(f.filename ?? "—") },
                  { header: "Typ", width: 18, get: (f) => String(f.content_type ?? "—") },
                  { header: "Label", width: 12, get: (f) => String(f.context_label ?? "—") },
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

        case "update": {
          // Kontext-Zuordnung NACHTRAEGLICH setzen (PATCH /files/{id}/context) — loest das
          // Henne-Ei des News-Flows: Assets werden VOR news apply hochgeladen (keine news-id),
          // danach an die News haengen: data update <file-id> --context news --context-id <news-id>.
          // Nur angegebene Flags werden gesendet; Wert "none" loescht das Feld (explizites null).
          if (!arg) throw new Error("data update <file-id> benoetigt eine Datei-ID.");
          const patch: Record<string, unknown> = {};
          if (opts.context !== undefined) patch.context_type = contextPatchValue(opts.context);
          if (opts.contextId !== undefined) patch.context_id = contextPatchValue(opts.contextId);
          if (opts.subContextId !== undefined) patch.sub_context_id = contextPatchValue(opts.subContextId);
          if (opts.label !== undefined) patch.context_label = contextPatchValue(opts.label);
          if (Object.keys(patch).length === 0) {
            throw new Error(
              "data update benoetigt mindestens eines von --context, --context-id, --sub-context-id, --label.",
            );
          }
          const updated = await client.patch<FileEntryRead>("content", `/files/${arg}/context`, patch);
          output(updated, opts.json, () =>
            `Kontext aktualisiert: ${updated.filename ?? arg} -> context=${updated.context_type ?? "—"}, context_id=${updated.context_id ?? "—"}${updated.context_label ? `, label=${updated.context_label}` : ""}`,
          );
          break;
        }

        case "url": {
          // Nur die presigned S3-URL holen (KEIN Download) — fuer das Einbetten von
          // Galerie-Bildern in Rich-News/Homepage-Content. Presigned URLs laufen ab;
          // fuer News re-signt das Backend anhand von data-comvenio-file-id.
          if (!arg) throw new Error("data url <file-id> benoetigt eine Datei-ID.");
          const res = await client.post<DownloadURLOut>("content", `/files/download-url`, {
            file_id: arg,
          });
          if (!res.url) throw new Error("Keine Download-URL vom content-service erhalten.");
          output({ file_id: arg, url: res.url, expires_in: res.expires_in }, opts.json, () =>
            `${res.url}${res.expires_in ? `  (gueltig ~${res.expires_in}s)` : ""}`,
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
          output({ file_id: arg, out, size_bytes: bytes.byteLength, url: res.url }, opts.json, () =>
            `Heruntergeladen: ${out} (${bytes.byteLength} Bytes)`,
          );
          break;
        }

        case "upload": {
          if (!arg) throw new Error("data upload <pfad> benoetigt eine lokale Datei.");
          if (!opts.context) throw new Error("data upload benoetigt --context <type>.");

          // --optimize-video (mobile Autoplay, RTS-Item 39183f0b): re-encoded via ffmpeg in ein
          // temp-Verzeichnis BEVOR presign-upload aufgerufen wird — Original bleibt unangetastet,
          // nur die optimierte Kopie wird hochgeladen. Temp-Verzeichnis wird danach immer aufgeraeumt.
          let uploadPath = arg;
          let optimizedDir: string | undefined;
          let optimizeStats: { inputSizeBytes: number; outputSizeBytes: number } | undefined;
          if (opts.optimizeVideo) {
            if (!isVideoFile(arg)) {
              throw new Error(
                "--optimize-video erwartet eine Video-Datei (.mp4/.mov/.webm/.mkv).",
              );
            }
            const optimized = await optimizeVideoForWeb(arg);
            uploadPath = optimized.path;
            optimizedDir = optimized.dir;
            optimizeStats = optimized;
            console.error(
              `Video optimiert: ${formatMb(optimized.inputSizeBytes)} MB -> ${formatMb(optimized.outputSizeBytes)} MB`,
            );
          }

          try {
            const uploaded = await uploadClubFile({
              client,
              clubId,
              path: uploadPath,
              contextType: opts.context,
              contextId: opts.contextId,
              subContextId: opts.subContextId,
              departmentId: opts.department,
              label: opts.label,
              isPublic: opts.public,
            });
            output(
              optimizeStats ? { ...uploaded, optimized: optimizeStats } : uploaded,
              opts.json,
              () =>
                `Bereitgestellt: ${uploaded.filename} (${uploaded.size_bytes ?? "?"} Bytes, ${uploaded.visibility}) — file_id ${uploaded.file_id}` +
                (optimizeStats
                  ? `\nVideo optimiert: ${formatMb(optimizeStats.inputSizeBytes)} MB -> ${formatMb(optimizeStats.outputSizeBytes)} MB`
                  : ""),
            );
          } finally {
            if (optimizedDir) cleanupOptimizedVideo(optimizedDir);
          }
          break;
        }

        case "delete": {
          if (!arg) throw new Error("data delete <file-id> benoetigt eine Datei-ID.");
          await client.del("content", `/files/${arg}${opts.hard ? "?hard=true" : ""}`);
          output({ ok: true, file_id: arg, hard: Boolean(opts.hard) }, opts.json, () =>
            opts.hard ? `Datei endgueltig geloescht: ${arg}` : `Datei in den Papierkorb verschoben: ${arg}`,
          );
          break;
        }

        case "restore": {
          if (!arg) throw new Error("data restore <file-id> benoetigt eine Datei-ID.");
          await client.post("content", `/files/${arg}/restore`);
          output({ ok: true, file_id: arg }, opts.json, () => `Datei wiederhergestellt: ${arg}`);
          break;
        }

        case "move": {
          if (!arg) throw new Error("data move <file-id> benoetigt eine Datei-ID.");
          if (opts.folder === undefined) throw new Error("data move benoetigt --folder <id|root>.");
          const folderId = nullableFolder(opts.folder);
          await client.post("content", `/files/${arg}/move`, { target_folder_id: folderId });
          output({ ok: true, file_id: arg, folder_id: folderId }, opts.json, () => `Datei verschoben: ${arg}`);
          break;
        }

        case "visibility": {
          if (!arg) throw new Error("data visibility <file-id> benoetigt eine Datei-ID.");
          if (opts.visibility !== "public" && opts.visibility !== "private") {
            throw new Error("data visibility benoetigt --visibility public|private.");
          }
          const updated = await client.patch<FileEntryRead>("content", `/files/${arg}/visibility`, {
            visibility: opts.visibility,
          });
          output(updated, opts.json, () => `Sichtbarkeit gesetzt: ${arg} -> ${opts.visibility}`);
          break;
        }

        case "stats": {
          const stats = await client.get(
            "content",
            `/files/storage-stats${query({ club_id: clubId, club_department_id: opts.department })}`,
          );
          output(stats, opts.json, () => JSON.stringify(stats, null, 2));
          break;
        }

        case "empty-trash": {
          const result = await client.post("content", "/files/empty-trash", {
            club_id: clubId,
            club_department_id: opts.department,
            folder_id: nullableFolder(opts.folder),
          });
          output(result, opts.json, () => JSON.stringify(result, null, 2));
          break;
        }

        case "area-media": {
          const params = new URLSearchParams({ club_id: clubId });
          for (const areaId of (opts.areaIds ?? "").split(",").map((id) => id.trim()).filter(Boolean)) {
            params.append("area_ids", areaId);
          }
          if (opts.label) params.set("label", opts.label);
          const rows = await client.get("content", `/files/areas/media-map?${params.toString()}`);
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }

        case "area-shares": {
          if (!arg) throw new Error("data area-shares <file-id> benoetigt eine Datei-ID.");
          const rows = await client.get("content", `/files/${arg}/area-shares`);
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }

        case "area-share-add": {
          if (!arg) throw new Error("data area-share-add <file-id> benoetigt eine Datei-ID.");
          const areaIds = (opts.areaIds ?? "").split(",").map((id) => id.trim()).filter(Boolean);
          if (!areaIds.length) throw new Error("data area-share-add benoetigt --area-ids <id,id,...>.");
          await client.post("content", `/files/${arg}/area-shares`, { area_ids: areaIds });
          output({ ok: true, file_id: arg, area_ids: areaIds }, opts.json, () =>
            `Datei mit ${areaIds.length} Event-Bereichen geteilt.`,
          );
          break;
        }

        case "area-share-remove": {
          if (!arg || !opts.areaId) {
            throw new Error("data area-share-remove <file-id> benoetigt --area-id <id>.");
          }
          await client.del("content", `/files/${arg}/area-shares/${opts.areaId}`);
          output({ ok: true, file_id: arg, area_id: opts.areaId }, opts.json, () =>
            `Area-Freigabe entfernt: ${opts.areaId}`,
          );
          break;
        }

        case "children": {
          const result = await client.get("content", `/folders/children${query({
            club_id: clubId,
            club_department_id: opts.department,
            parent_id: nullableFolder(opts.parent),
            include_deleted: opts.includeDeleted,
          })}`);
          output(result, opts.json, () => JSON.stringify(result, null, 2));
          break;
        }

        case "search": {
          if (!opts.query) throw new Error("data search benoetigt --query <text>.");
          const result = await client.get("content", `/folders/search${query({
            club_id: clubId,
            club_department_id: opts.department,
            folder_id: nullableFolder(opts.folder),
            q: opts.query,
            recursive: opts.recursive,
          })}`);
          output(result, opts.json, () => JSON.stringify(result, null, 2));
          break;
        }

        case "breadcrumb": {
          if (!arg) throw new Error("data breadcrumb <folder-id> benoetigt eine Ordner-ID.");
          const result = await client.get("content", `/folders/${arg}/breadcrumb`);
          output(result, opts.json, () => JSON.stringify(result, null, 2));
          break;
        }

        case "folder-create": {
          if (!opts.name) throw new Error("data folder-create benoetigt --name <name>.");
          const folder = await client.post("content", "/folders", {
            club_id: clubId,
            club_department_id: opts.department,
            parent_id: nullableFolder(opts.parent),
            name: opts.name,
            is_protected: boolValue(opts.protected, "--protected") ?? false,
          });
          output(folder, opts.json, () => `Ordner angelegt: ${opts.name}`);
          break;
        }

        case "folder-rename": {
          if (!arg || !opts.name) throw new Error("data folder-rename <folder-id> --name <name>.");
          const folder = await client.patch("content", `/folders/${arg}/rename`, { new_name: opts.name });
          output(folder, opts.json, () => `Ordner umbenannt: ${arg}`);
          break;
        }

        case "folder-move": {
          if (!arg || opts.parent === undefined) throw new Error("data folder-move <folder-id> --parent <id|root>.");
          const folder = await client.patch("content", `/folders/${arg}/move`, {
            new_parent_id: nullableFolder(opts.parent),
          });
          output(folder, opts.json, () => `Ordner verschoben: ${arg}`);
          break;
        }

        case "folder-protect": {
          if (!arg) throw new Error("data folder-protect <folder-id> benoetigt eine Ordner-ID.");
          const protect = boolValue(opts.protected, "--protected");
          if (protect === undefined) throw new Error("data folder-protect benoetigt --protected true|false.");
          const folder = await client.patch("content", `/folders/${arg}/protect?protect=${protect}`, {});
          output(folder, opts.json, () => `Ordnerschutz gesetzt: ${arg} -> ${protect}`);
          break;
        }

        case "folder-delete":
        case "folder-restore": {
          if (!arg) throw new Error(`data ${action} <folder-id> benoetigt eine Ordner-ID.`);
          const recursive = opts.recursive !== false;
          if (action === "folder-delete") {
            await client.del("content", `/folders/${arg}?recursive=${recursive}`);
          } else {
            await client.post("content", `/folders/${arg}/restore?recursive=${recursive}`);
          }
          output({ ok: true, folder_id: arg, recursive }, opts.json, () =>
            action === "folder-delete" ? `Ordner geloescht: ${arg}` : `Ordner wiederhergestellt: ${arg}`,
          );
          break;
        }

        case "folder-rights": {
          if (!arg) throw new Error("data folder-rights <folder-id> benoetigt eine Ordner-ID.");
          const rows = await client.get("content", `/folder-rights/by-folder/${arg}`);
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }

        case "folder-right-add": {
          const row = await client.post("content", "/folder-rights", fileBody(opts, "data folder-right-add"));
          output(row, opts.json, () => "Ordnerrecht angelegt");
          break;
        }

        case "folder-right-bulk": {
          if (!opts.file) throw new Error("data folder-right-bulk benoetigt --file <payload.json>.");
          const body = readJsonFile<unknown>(opts.file);
          if (!Array.isArray(body)) throw new Error("data folder-right-bulk: JSON-Payload muss ein Array sein.");
          const rows = await client.post("content", "/folder-rights/bulk", body);
          output(rows, opts.json, () => "Ordnerrechte angelegt");
          break;
        }

        case "folder-right-delete": {
          if (!arg) throw new Error("data folder-right-delete <right-id> benoetigt eine Rechte-ID.");
          await client.del("content", `/folder-rights/${arg}`);
          output({ ok: true, right_id: arg }, opts.json, () => `Ordnerrecht geloescht: ${arg}`);
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

        case "paper-show": {
          if (!arg) throw new Error("data paper-show <paper-id> benoetigt eine Paper-ID.");
          const paper = await client.get("content", `/papers/${arg}`);
          output(paper, opts.json, () => JSON.stringify(paper, null, 2));
          break;
        }

        case "paper-add": {
          const paper = await client.post(
            "content",
            `/papers/club/${clubId}`,
            fileBody(opts, "data paper-add"),
          );
          output(paper, opts.json, () => "Paper angelegt");
          break;
        }

        case "paper-update": {
          if (!arg) throw new Error("data paper-update <paper-id> benoetigt eine Paper-ID.");
          const paper = await client.put(
            "content",
            `/papers/${arg}`,
            fileBody(opts, "data paper-update"),
          );
          output(paper, opts.json, () => `Paper aktualisiert: ${arg}`);
          break;
        }

        case "paper-delete": {
          if (!arg) throw new Error("data paper-delete <paper-id> benoetigt eine Paper-ID.");
          await client.del("content", `/papers/${arg}`);
          output({ ok: true, paper_id: arg }, opts.json, () => `Paper geloescht: ${arg}`);
          break;
        }

        case "export": {
          // K13 — strukturierter CSV/XLSX-Export (read-only Backend-Endpoints).
          if (arg !== "members" && arg !== "bookings") {
            throw new Error("data export <members|bookings> — nur diese beiden Entitaeten.");
          }
          if (opts.format && opts.format !== "csv" && opts.format !== "xlsx") {
            throw new Error("data export --format erwartet csv oder xlsx.");
          }
          const fmt = opts.format ?? "csv";
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
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, url, download, upload, update, delete, restore, move, visibility, stats, empty-trash, area-media, area-shares, area-share-add, area-share-remove, children, search, breadcrumb, folder-create, folder-rename, folder-move, folder-protect, folder-delete, folder-restore, folder-rights, folder-right-add, folder-right-bulk, folder-right-delete, papers, paper-show, paper-add, paper-update, paper-delete, export`,
          );
      }
    });
}
