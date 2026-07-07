import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import { resolve } from "node:path";

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
//   4. comvenio news preview --file news.json --open   -> lokale HTML-Vorschau (kein Write)
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
  out?: string;
};

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

// Lokale, backend-freie HTML-Vorschau der komponierten News. Zeigt Titelbild (cover_url),
// Titel, Teaser und den rich-HTML-content in einem schlichten News-Detail-Layout. Der content
// ist vom Agenten komponiertes, vertrauenswuerdiges HTML und wird bewusst roh eingesetzt.
function buildNewsPreviewHtml(payload: Record<string, unknown>): string {
  const title = esc(payload.title);
  const teaser = payload.teaser ? esc(payload.teaser) : "";
  const content = String(payload.content ?? "");
  const coverUrl = payload.cover_url ? String(payload.cover_url) : "";
  const isDraft = payload.is_draft !== false; // Default True (wie Backend)
  const badge = isDraft
    ? '<span class="badge draft">Entwurf &middot; nur fuer Admins sichtbar</span>'
    : '<span class="badge live">Veroeffentlicht &middot; oeffentlich</span>';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vorschau: ${title}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef1f5; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a2230; line-height: 1.65; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
  .note { font-size: 12px; color: #6b7686; text-align: center; margin: 0 0 16px; }
  article { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(20,30,50,.10); }
  .cover { width: 100%; display: block; aspect-ratio: 16/7; object-fit: cover; background: #dde3ec; }
  .body { padding: 28px clamp(18px, 5vw, 40px) 40px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; margin-bottom: 14px; }
  .badge.draft { background: #fff3d6; color: #9a6a00; }
  .badge.live { background: #d9f4e3; color: #1c6b3f; }
  h1 { font-size: clamp(26px, 4.5vw, 38px); line-height: 1.15; margin: 4px 0 10px; letter-spacing: -.01em; }
  .teaser { font-size: 18px; color: #4a5568; margin: 0 0 24px; font-weight: 500; }
  .content { font-size: 17px; }
  .content img { max-width: 100%; height: auto; border-radius: 12px; margin: 18px 0; display: block; }
  .content h2 { font-size: 22px; margin: 30px 0 8px; letter-spacing: -.01em; }
  .content h3 { font-size: 19px; margin: 24px 0 6px; }
  .content p { margin: 12px 0; }
  .content ul, .content ol { padding-left: 22px; }
  @media (prefers-color-scheme: dark) {
    body { background: #10151d; color: #e6ebf2; }
    article { background: #1a2130; box-shadow: none; }
    .teaser { color: #a7b2c2; }
    .cover { background: #232c3c; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <p class="note">Lokale Vorschau (comvenio news preview) — nicht veroeffentlicht, kein Backend-Write.</p>
    <article>
      ${coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="Titelbild">` : ""}
      <div class="body">
        ${badge}
        <h1>${title}</h1>
        ${teaser ? `<p class="teaser">${teaser}</p>` : ""}
        <div class="content">${content}</div>
      </div>
    </article>
  </div>
</body>
</html>`;
}

export function registerNewsCommands(cli: CAC): void {
  cli
    .command("news <action> [id]", "Vereinsnews: list|show|create|update|delete|apply|preview|publish (rich HTML)")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
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
    .option("--open", "preview: die lokale HTML-Vorschau im Browser oeffnen")
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
          // Lokale, backend-freie HTML-Vorschau des komponierten Rich-HTML (kein Write).
          if (!opts.file) throw new Error("news preview benoetigt --file <news.json>.");
          const payload = readJsonFile<Record<string, unknown>>(opts.file);
          if (!payload.title) throw new Error("news.json benoetigt 'title'.");
          if (!payload.content) throw new Error("news.json benoetigt 'content'.");
          // is_draft/published-Intent aus Flags in die Vorschau-Badge spiegeln.
          const df = draftFields();
          if (df.is_draft !== undefined) payload.is_draft = df.is_draft;
          const html = buildNewsPreviewHtml(payload);
          const outPath = opts.out ?? "./news-preview.html";
          await Bun.write(outPath, html);
          const abs = resolve(outPath);
          let opened = false;
          if (opts.open) opened = await openInBrowser(abs);
          output({ out: outPath, opened: opts.open ? opened : undefined }, opts.json, () => {
            const openHint = opts.open
              ? opened
                ? "\nIm Browser geoeffnet."
                : `\nBrowser nicht automatisch geoeffnet — Datei manuell oeffnen: ${abs}`
              : "";
            return `Lokale Vorschau geschrieben: ${outPath}${openHint}`;
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
          // cover_url ist ein reines Vorschau-Feld (presigned, laeuft ab) — NIE ans Backend schicken.
          delete payload.cover_url;
          // --draft/--publish stechen den JSON-Wert (published stackt is_draft=false + published_at).
          Object.assign(payload, draftFields());
          const applied = await client.post<NewsRead>("content", `/news/club/${clubId}`, payload);
          output(applied, opts.json, () =>
            `Rich-News erstellt (design_source=${applied.design_source}, ${applied.is_draft ? "Entwurf — mit 'news publish " + applied.id + "' veroeffentlichen" : "Live"}): ${applied.id}`,
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, update, delete, apply, preview, publish`,
          );
      }
    });
}
