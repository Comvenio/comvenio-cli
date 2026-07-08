import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import { uploadClubFile } from "../util/upload.ts";
import { VIDEO_TEMPLATES, isVideoTemplate, validateVideoParams } from "../util/videoParams.ts";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// K2 — `comvenio news`: Vereinsnews verfassen, ansehen + veroeffentlichen, direkt gegen den
// content-service. PRIMAER: `news apply --file news.json` — der bedienende Agent
// (Claude/Codex) komponiert professionelles rich HTML mit eingebetteten Comvenio-
// Galerie-Bildern SELBST und schickt es deterministisch ab (design_source=cli wird
// erzwungen). Ruft NICHT ai-service /news/generate — der CLI-Agent IST das LLM (D-02).
// Galerie-Bilder kommen via `comvenio data list/download` (Sub-File 12). gateway key "content".
//
// Entwurf/Veroeffentlichung (content-service NewsEntry, verifiziert 2026-07-07):
//   is_draft=True  (Schema-Default!) -> News nur fuer Admins sichtbar, NICHT oeffentlich.
//   Veroeffentlichen = is_draft=False + published_at setzen.
//   -> Ohne --publish bleibt eine News ein Entwurf. `news publish <id>` schaltet sie live.
//   -> `news update` ist ein PUT (Vollersatz): wir holen die News zuerst und mergen,
//      damit keine Felder verloren gehen.
//
// Bildquelle-Workflow (Agent, D-03):
//   1. comvenio data list --context event --context-id <fest> --json   -> FileEntry[]
//   2. comvenio data download <file_id> --json                          -> { url: presigned }
//   3. Agent komponiert news.json: Header-Bild als erstes Element im content
//      <img src="<presigned>" data-comvenio-file-id="<file_id>"> (Backend re-signt via file-id),
//      danach <h2>/<p> je Tag/Abschnitt. Optional cover_image_file_id fuer das Titelbild.
//      Zusaetzlich cover_url (presigned) NUR fuer die lokale Vorschau (wird vor dem POST entfernt).
//   4. comvenio news preview --file news.json --open   -> Backend-Vorschau-URL (K8); --local = Offline-Fallback
//   5. comvenio news apply --file news.json --publish  -> veroeffentlicht (design_source=cli)

type NewsRead = {
  id?: string;
  title?: string;
  content?: string;
  teaser?: string;
  cover_image_file_id?: string | null;
  category_id?: string | null;
  club_department_id?: string | null;
  visibility_scope?: string;
  published_at?: string | null;
  is_pinned?: boolean;
  is_draft?: boolean;
  reference_id?: string | null;
  reference_type?: string;
  reference_url?: string | null;
  reference_label?: string | null;
  design_source?: string;
  created_at?: string;
  [k: string]: unknown;
};

type NewsOpts = {
  json?: boolean;
  club?: string;
  title?: string;
  content?: string;
  teaser?: string;
  visibility?: string;
  designSource?: string;
  cover?: string;
  file?: string;
  draft?: boolean;
  publish?: boolean;
  pinned?: boolean;
  open?: boolean;
  local?: boolean;
  out?: string;
  // news video (K7)
  params?: string;
  duration?: string;
  upload?: boolean;
  context?: string;
  contextId?: string;
  public?: boolean;
};

// K7: 200 MB — must match content-service MAX_FILE_UPLOAD_BYTES code default (D-10)
const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;

// remotion/ sub-project location: env override (compiled binary) or repo-relative (bun run)
function resolveRemotionDir(): string {
  const fromEnv = process.env.COMVENIO_CLI_REMOTION_DIR;
  if (fromEnv) return fromEnv;
  return resolve(import.meta.dir, "../../remotion");
}

function buildVideoEmbedSnippet(url: string): string {
  return [
    '<figure class="rn-video">',
    '  <video controls preload="metadata">',
    `    <source src="${url}" type="video/mp4" />`,
    "    Dein Browser kann dieses Video nicht abspielen.",
    "  </video>",
    "</figure>",
    '<figcaption class="rn-caption" data-edit>Bildunterschrift <span class="rn-credit">Video: …</span></figcaption>',
  ].join("\n");
}

// content-service NewsEntry-Felder, die ein Vollersatz-PUT (news update/publish) mitsenden muss.
// Wir bauen den Body aus einem NewsRead, damit ein PUT keine Felder auf ihre Defaults zuruecksetzt
// (is_draft-Default ist True — ein naiver Teil-PUT wuerde eine Live-News versehentlich zum Entwurf machen).
function fullBodyFromRead(n: NewsRead): Record<string, unknown> {
  return {
    title: n.title,
    content: n.content,
    teaser: n.teaser ?? null,
    cover_image_file_id: n.cover_image_file_id ?? null,
    category_id: n.category_id ?? null,
    club_department_id: n.club_department_id ?? null,
    visibility_scope: n.visibility_scope ?? "member",
    published_at: n.published_at ?? null,
    is_pinned: n.is_pinned ?? false,
    is_draft: n.is_draft ?? true,
    reference_id: n.reference_id ?? null,
    reference_type: n.reference_type ?? "none",
    reference_url: n.reference_url ?? null,
    reference_label: n.reference_label ?? null,
    design_source: n.design_source ?? "cli",
  };
}

// Best-effort Browser-Open (URLs UND lokale Dateipfade) — plattformabhaengig,
// gleiches Muster wie tournament.ts/homepage.ts.
async function openInBrowser(target: string): Promise<boolean> {
  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", target]
        : process.platform === "darwin"
          ? ["open", target]
          : ["xdg-open", target];
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return true;
  } catch {
    return false;
  }
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// Lokale, backend-freie HTML-Vorschau — spiegelt das ECHTE web.comvenio.app News-Detail-Layout
// (Club-Header-Leiste, Cover, Titel, Teaser, Autor-Zeile, Content) statt eines erfundenen Layouts,
// damit die Vorschau zeigt, wie die News auf der Seite tatsaechlich aussieht. Das Content-Styling
// bildet den web-page RichTextRenderer nach (h2/img/section/figure + inline-styles der cli-News).
// Optionale Preview-Felder: club_name, author_name, preview_date (werden beim apply verworfen).
function buildNewsPreviewHtml(payload: Record<string, unknown>): string {
  const title = esc(payload.title);
  const teaser = payload.teaser ? esc(payload.teaser) : "";
  const content = String(payload.content ?? "");
  const coverUrl = payload.cover_url ? String(payload.cover_url) : "";
  const clubName = esc(payload.club_name ?? "Verein");
  const author = payload.author_name ? esc(payload.author_name) : "";
  const dateStr = payload.preview_date ? esc(payload.preview_date) : "";
  const isDraft = payload.is_draft !== false;
  const statusNote = isDraft
    ? "Entwurf — nur fuer Admins sichtbar"
    : "Veroeffentlicht — oeffentlich sichtbar";
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vorschau: ${title}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef1f5; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a2230; }
  .note { font-size: 12px; color: #6b7686; text-align: center; margin: 14px 16px; }
  /* News-Detail-Scaffold (wie web.comvenio.app) */
  .page { max-width: 900px; margin: 0 auto 64px; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 8px rgba(20,30,50,.08); }
  .clubbar { display: flex; align-items: center; justify-content: space-between; background: #16205a; color: #fff; padding: 12px 20px; }
  .clubbar .name { font-weight: 700; font-size: 15px; }
  .clubbar .tag { border: 1px solid rgba(255,255,255,.5); border-radius: 6px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  .cover { width: 100%; display: block; }
  .body { padding: 24px clamp(18px, 4vw, 40px) 48px; }
  h1.title { font-size: clamp(26px, 4vw, 40px); font-weight: 800; line-height: 1.15; margin: 8px 0 14px; color: #1a2230; }
  .teaser { font-size: 16px; color: #5a6a7d; margin: 0 0 20px; line-height: 1.6; }
  .author { display: flex; align-items: center; gap: 10px; padding: 4px 0 18px; border-bottom: 1px solid #e6eaf0; margin-bottom: 8px; }
  .author .avatar { width: 34px; height: 34px; border-radius: 50%; background: #c9d3e2; display: inline-block; }
  .author .who { font-size: 13px; }
  .author .who b { display: block; color: #1a2230; }
  .author .who span { color: #7a8798; }
  /* Content: bildet den RichTextRenderer nach (MUI sx) */
  .content { font-size: 16px; line-height: 1.75; color: #1a2230; word-break: break-word; }
  .content p { margin: 0 0 10px; }
  .content h1 { font-size: 1.75rem; font-weight: 700; margin: 24px 0 10px; }
  .content h2 { font-size: 1.4rem; font-weight: 700; margin: 20px 0 8px; }
  .content h3 { font-size: 1.15rem; font-weight: 600; margin: 16px 0 6px; }
  .content img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; display: block; }
  .content section { margin-bottom: 16px; }
  .content figure { margin: 16px 0; }
  .content figcaption { font-size: .875rem; color: #5a6a7d; margin-top: 4px; text-align: center; }
  .content ul, .content ol { padding-left: 24px; margin: 0 0 10px; }
  .content li { margin-bottom: 4px; }
  .content a { color: #1c4fd8; text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    body { background: #10151d; color: #e6ebf2; }
    .page { background: #1a2130; box-shadow: none; }
    h1.title, .content, .content h1, .content h2, .content h3 { color: #e6ebf2; }
    .teaser, .content figcaption { color: #a7b2c2; }
    .author { border-color: #2a3446; }
    .author .who b { color: #e6ebf2; }
  }
</style>
</head>
<body>
  <p class="note">Lokale Vorschau (comvenio news preview) — spiegelt das web.comvenio.app-Layout. ${statusNote}. Kein Backend-Write.</p>
  <div class="page">
    <div class="clubbar"><span class="name">${clubName}</span><span class="tag">News</span></div>
    ${coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="Titelbild">` : ""}
    <div class="body">
      <h1 class="title">${title}</h1>
      ${teaser ? `<p class="teaser">${teaser}</p>` : ""}
      ${author ? `<div class="author"><span class="avatar"></span><span class="who"><b>${author}</b><span>${dateStr}</span></span></div>` : ""}
      <div class="content">${content}</div>
    </div>
  </div>
</body>
</html>`;
}

export function registerNewsCommands(cli: CAC): void {
  cli
    .command("news <action> [id]", "Vereinsnews: list|show|create|update|delete|apply|preview|publish|video (rich HTML)")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--params <file>", "video: params.json (Zod-validiert pro Template)")
    .option("--duration <sec>", "video: Dauer in Sekunden uebersteuern")
    .option("--upload", "video: gerendertes MP4 via Presign zum content-service hochladen")
    .option("--context <type>", "video --upload: context_type der Datei (Default news)")
    .option("--context-id <id>", "video --upload: context_id (z.B. Event-ID)")
    .option("--public", "video --upload: Sichtbarkeit public (Default private)")
    .option("--title <v>", "Titel (create/update)")
    .option("--content <v>", "HTML-Content (create/update)")
    .option("--teaser <v>", "Teaser-Text (create/update)")
    .option("--visibility <v>", "Sichtbarkeit public|member|department (create/update; Default member)")
    .option("--design-source <v>", "webapp|cli (create/update; apply erzwingt cli)")
    .option("--cover <file_id>", "Titelbild: cover_image_file_id (create/update)")
    .option("--file <path>", "news.json (apply/preview): vom Agenten komponierte rich-HTML-News")
    .option("--draft", "create/apply: als Entwurf anlegen (is_draft=true, nur Admins sehen es)")
    .option("--publish", "create/apply: sofort veroeffentlichen (is_draft=false + published_at=jetzt)")
    .option("--pinned", "create/update: News anpinnen (is_pinned=true)")
    .option("--open", "preview: die Vorschau im Browser oeffnen")
    .option("--local", "preview: lokaler Offline-Fallback (Naeherung) statt Backend-Vorschau")
    .option("--out <path>", "preview: Zielpfad der HTML-Datei (Default ./news-preview.html)")
    .option("--json", "Maschinenlesbares JSON")
    .action(async (action: string, id: string | undefined, opts: NewsOpts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      // is_draft/published_at aus --draft/--publish ableiten (publish sticht draft).
      // Rueckgabe undefined = Feld nicht setzen (Backend-Default greift).
      const draftFields = (): { is_draft?: boolean; published_at?: string } => {
        if (opts.publish) return { is_draft: false, published_at: new Date().toISOString() };
        if (opts.draft) return { is_draft: true };
        return {};
      };

      switch (action) {
        case "list": {
          const rows = await client.get<NewsRead[]>("content", `/news/club/${clubId}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Titel", width: 34, get: (n) => String(n.title ?? "—") },
                  { header: "Status", width: 10, get: (n) => (n.is_draft ? "Entwurf" : "Live") },
                  { header: "Quelle", width: 7, get: (n) => String(n.design_source ?? "webapp") },
                  { header: "Sicht", width: 10, get: (n) => String(n.visibility_scope ?? "—") },
                  { header: "id", width: 38, get: (n) => String(n.id ?? "—") },
                ])
              : "Keine News.",
          );
          break;
        }

        case "show": {
          if (!id) throw new Error("news show <news-id> benoetigt eine News-ID.");
          const n = await client.get<NewsRead>("content", `/news/${id}`);
          output(n, opts.json, () =>
            `${n.title ?? "—"} [${n.is_draft ? "Entwurf" : "Live"}, ${n.design_source ?? "webapp"}, ${n.visibility_scope ?? "?"}] — ${n.id}`,
          );
          break;
        }

        case "create": {
          if (!opts.title) throw new Error("news create benoetigt --title.");
          if (!opts.content) throw new Error("news create benoetigt --content.");
          const body: Record<string, unknown> = { title: opts.title, content: opts.content };
          if (opts.teaser) body.teaser = opts.teaser;
          if (opts.visibility) body.visibility_scope = opts.visibility;
          if (opts.designSource) body.design_source = opts.designSource;
          if (opts.cover) body.cover_image_file_id = opts.cover;
          if (opts.pinned) body.is_pinned = true;
          Object.assign(body, draftFields());
          const created = await client.post<NewsRead>("content", `/news/club/${clubId}`, body);
          output(created, opts.json, () =>
            `News erstellt: ${created.id} (${created.is_draft ? "Entwurf — mit 'news publish' veroeffentlichen" : "Live"}, design_source=${created.design_source ?? "webapp"})`,
          );
          break;
        }

        case "update": {
          if (!id) throw new Error("news update <news-id> benoetigt eine News-ID.");
          // PUT ist Vollersatz — bestehende News holen und mergen, sonst gehen Felder verloren
          // (u. a. wuerde is_draft auf den Default True zurueckfallen).
          const current = await client.get<NewsRead>("content", `/news/${id}`);
          const body = fullBodyFromRead(current);
          // --file: vom Agenten komponiertes Rich-HTML-JSON in den Body mergen (Vorschau-Felder
          // strippen, design_source=cli erzwingen). Flags unten ueberschreiben das JSON.
          if (opts.file) {
            const payload = readJsonFile<Record<string, unknown>>(opts.file);
            delete payload.cover_url;
            delete payload.club_name;
            delete payload.author_name;
            delete payload.preview_date;
            payload.design_source = "cli";
            Object.assign(body, payload);
          }
          if (opts.title) body.title = opts.title;
          if (opts.content) body.content = opts.content;
          if (opts.teaser !== undefined) body.teaser = opts.teaser;
          if (opts.visibility) body.visibility_scope = opts.visibility;
          if (opts.designSource) body.design_source = opts.designSource;
          if (opts.cover) body.cover_image_file_id = opts.cover;
          if (opts.pinned) body.is_pinned = true;
          Object.assign(body, draftFields());
          const updated = await client.put<NewsRead>("content", `/news/${id}`, body);
          output(updated, opts.json, () => `News aktualisiert: ${updated.id} (${updated.is_draft ? "Entwurf" : "Live"})`);
          break;
        }

        case "publish": {
          if (!id) throw new Error("news publish <news-id> benoetigt eine News-ID.");
          // Draft -> Live: bestehende News holen, is_draft=false + published_at setzen, Vollersatz-PUT.
          const current = await client.get<NewsRead>("content", `/news/${id}`);
          const body = fullBodyFromRead(current);
          body.is_draft = false;
          body.published_at = current.published_at ?? new Date().toISOString();
          const published = await client.put<NewsRead>("content", `/news/${id}`, body);
          output(published, opts.json, () =>
            `News veroeffentlicht: ${published.title ?? id} (${published.visibility_scope ?? "?"}) — ${published.id}`,
          );
          break;
        }

        case "delete": {
          if (!id) throw new Error("news delete <news-id> benoetigt eine News-ID.");
          await client.del("content", `/news/${id}`);
          output({ deleted: id }, opts.json, () => `News geloescht: ${id}`);
          break;
        }

        case "preview": {
          if (!opts.file) throw new Error("news preview benoetigt --file <news.json>.");
          const payload = readJsonFile<Record<string, unknown>>(opts.file);
          if (!payload.title) throw new Error("news.json benoetigt 'title'.");
          if (!payload.content) throw new Error("news.json benoetigt 'content'.");

          if (opts.local) {
            // K8: lokaler Naeherungs-Preview (Offline-Fallback) — massgeblich ist die
            // Backend-Vorschau (echtes Layout inkl. .rich-news-CSS; lokal droht CSS-Drift).
            const df = draftFields();
            if (df.is_draft !== undefined) payload.is_draft = df.is_draft;
            const html = buildNewsPreviewHtml(payload);
            const outPath = opts.out ?? "./news-preview.html";
            await Bun.write(outPath, html);
            const abs = resolve(outPath);
            let opened = false;
            if (opts.open) opened = await openInBrowser(abs);
            output({ out: outPath, opened: opts.open ? opened : undefined, local: true }, opts.json, () => {
              const openHint = opts.open
                ? opened
                  ? "\nIm Browser geoeffnet."
                  : `\nBrowser nicht automatisch geoeffnet — Datei manuell oeffnen: ${abs}`
                : "";
              return `Lokale Naeherungs-Vorschau geschrieben: ${outPath} (massgeblich ist die Backend-Vorschau ohne --local)${openHint}`;
            });
            break;
          }

          // K8 Default: Backend-TTL-Preview — content-service legt den Entwurf 30 Min ab,
          // die web-page rendert ihn im ECHTEN Layout (Scaffold + .rich-news + Re-Signing).
          const previewBody = {
            title: payload.title,
            content: payload.content,
            teaser: payload.teaser,
            cover_url: payload.cover_url,
            author_name: payload.author_name,
            club_name: payload.club_name,
            design_source: "cli",
          };
          const created = await client.post<{
            preview_id?: string;
            preview_url?: string;
            expires_at?: string;
          }>("content", `/news/club/${clubId}/preview`, previewBody);
          let opened = false;
          if (opts.open && created.preview_url) opened = await openInBrowser(created.preview_url);
          output(created, opts.json, () => {
            const openHint = opts.open
              ? opened
                ? "\nIm Browser geoeffnet."
                : "\nBrowser nicht automatisch geoeffnet — URL manuell oeffnen."
              : "";
            return `Backend-Vorschau erstellt (gueltig bis ${created.expires_at ?? "?"}):\n${created.preview_url ?? "?"}${openHint}\n(Offline-Fallback: news preview --file ... --local)`;
          });
          break;
        }

        case "apply": {
          // Deklarativer Rich-News-Create: Agent komponiert news.json selbst.
          if (!opts.file) throw new Error("news apply benoetigt --file <news.json>.");
          const payload = readJsonFile<Record<string, unknown>>(opts.file);
          if (!payload.title) throw new Error("news.json benoetigt 'title'.");
          if (!payload.content) throw new Error("news.json benoetigt 'content'.");
          // CLI-Rich-News: design_source=cli IMMER erzwungen (D-01/D-02) — unabhaengig vom JSON.
          payload.design_source = "cli";
          // Reine Vorschau-Felder — NIE ans Backend schicken (cover_url ist presigned/laeuft ab;
          // club_name/author_name/preview_date dienen nur der lokalen Layout-Vorschau).
          delete payload.cover_url;
          delete payload.club_name;
          delete payload.author_name;
          delete payload.preview_date;
          // --draft/--publish stechen den JSON-Wert (published stackt is_draft=false + published_at).
          Object.assign(payload, draftFields());
          const applied = await client.post<NewsRead>("content", `/news/club/${clubId}`, payload);
          output(applied, opts.json, () =>
            `Rich-News erstellt (design_source=${applied.design_source}, ${applied.is_draft ? "Entwurf — mit 'news publish " + applied.id + "' veroeffentlichen" : "Live"}): ${applied.id}`,
          );
          break;
        }

        case "video": {
          // K7: lokales Remotion-Rendering (NIEMALS im Backend, D-14) + optionaler Presign-Upload.
          const template = id ?? "";
          if (!isVideoTemplate(template)) {
            throw new Error(
              `Unbekanntes Template "${template || "(fehlt)"}". Verfuegbar: ${VIDEO_TEMPLATES.join(", ")}`,
            );
          }
          if (!opts.params) throw new Error("news video benoetigt --params <params.json>.");

          // 1. Zod-Validierung VOR dem (teuren) Render — Feldfehler sofort.
          const rawParams = readJsonFile<Record<string, unknown>>(opts.params);
          const validated = await validateVideoParams(template, rawParams);

          // 2. Dependency-Check: remotion/-Unterprojekt + node_modules (kein stiller Auto-Install).
          const remotionDir = resolveRemotionDir();
          if (!existsSync(join(remotionDir, "render.mjs"))) {
            throw new Error(
              `remotion/-Unterprojekt nicht gefunden (${remotionDir}). Im comvenio-cli-Repo ausfuehren oder COMVENIO_CLI_REMOTION_DIR setzen.`,
            );
          }
          if (!existsSync(join(remotionDir, "node_modules"))) {
            throw new Error(
              `Remotion-Dependencies fehlen. Einmalig installieren: cd ${remotionDir} && npm install`,
            );
          }

          // 3. Render als Node-Subprozess (robuster Bun/Node-Interop-Default, Sub-File 07).
          const outPath = resolve(
            opts.out ?? `./news-video-${template}-${Date.now()}.mp4`,
          );
          const validatedParamsPath = join(remotionDir, `.params-${process.pid}.json`);
          await Bun.write(validatedParamsPath, JSON.stringify(validated));
          try {
            const args = [
              "node",
              join(remotionDir, "render.mjs"),
              "--template", template,
              "--params", validatedParamsPath,
              "--out", outPath,
            ];
            if (opts.duration) args.push("--duration", String(Number(opts.duration)));
            const proc = Bun.spawn(args, { cwd: remotionDir, stdout: "inherit", stderr: "inherit" });
            const code = await proc.exited;
            if (code !== 0) throw new Error(`Remotion-Render fehlgeschlagen (Exit ${code}).`);
          } finally {
            try {
              await Bun.file(validatedParamsPath).delete();
            } catch {
              /* best effort cleanup */
            }
          }

          const rendered = Bun.file(outPath);
          if (!(await rendered.exists())) throw new Error(`Render-Output fehlt: ${outPath}`);

          // 4. Optional: Upload (Limit-Check VOR dem Upload) + Embed-Snippet.
          if (!opts.upload) {
            output({ out: outPath }, opts.json, () =>
              `Video gerendert: ${outPath}\nHochladen + einbetten: comvenio news video ${template} --params ${opts.params} --upload`,
            );
            break;
          }
          if (rendered.size > MAX_VIDEO_UPLOAD_BYTES) {
            throw new Error(
              `Video ist ${(rendered.size / 1024 / 1024).toFixed(0)} MB (> 200-MB-Upload-Limit) — Datei bleibt lokal: ${outPath}`,
            );
          }
          const uploaded = await uploadClubFile({
            client,
            clubId,
            path: outPath,
            contextType: opts.context ?? "news",
            contextId: opts.contextId,
            isPublic: opts.public,
          });
          const dl = await client.post<{ url?: string }>("content", "/files/download-url", {
            file_id: uploaded.file_id,
          });
          const snippet = buildVideoEmbedSnippet(dl.url ?? "");
          output(
            { out: outPath, file_id: uploaded.file_id, url: dl.url, snippet },
            opts.json,
            () =>
              `Video gerendert + hochgeladen (${uploaded.file_id}).\n\nEmbed-Snippet fuer news.json content:\n${snippet}`,
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, update, delete, apply, preview, publish, video`,
          );
      }
    });
}
