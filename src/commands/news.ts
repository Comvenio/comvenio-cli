import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

// K2 — `comvenio news`: Vereinsnews verfassen + veroeffentlichen, direkt gegen den
// content-service. PRIMAER: `news apply --file news.json` — der bedienende Agent
// (Claude/Codex) komponiert professionelles rich HTML mit eingebetteten Comvenio-
// Galerie-Bildern SELBST und schickt es deterministisch ab (design_source=cli wird
// erzwungen). Ruft NICHT ai-service /news/generate — der CLI-Agent IST das LLM (D-02).
// Galerie-Bilder kommen via `comvenio data list/download` (Sub-File 12). gateway key "content".
//
// Bildquelle-Workflow (Agent, D-03):
//   1. comvenio data list --context event --context-id <fest> --json   -> FileEntry[]
//   2. comvenio data download <file_id> --json                          -> { url: presigned }
//   3. Agent komponiert news.json: <img src="<presigned>" data-comvenio-file-id="<file_id>">
//      + <h1 data-edit>/<p data-edit> fuer editierbare Textknoten (Sub-File 04)
//   4. comvenio news apply --file news.json --json

type NewsRead = {
  id?: string;
  title?: string;
  design_source?: string;
  visibility_scope?: string;
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
  file?: string;
};

export function registerNewsCommands(cli: CAC): void {
  cli
    .command("news <action> [id]", "Vereinsnews: list|show|create|update|delete|apply (rich HTML)")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--title <v>", "Titel (create/update)")
    .option("--content <v>", "HTML-Content (create/update)")
    .option("--teaser <v>", "Teaser-Text (create/update)")
    .option("--visibility <v>", "Sichtbarkeit public|member|department (create/update; Default member)")
    .option("--design-source <v>", "webapp|cli (create/update; apply erzwingt cli)")
    .option("--file <path>", "news.json (apply): vom Agenten komponierte rich-HTML-News")
    .option("--json", "Maschinenlesbares JSON")
    .action(async (action: string, id: string | undefined, opts: NewsOpts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          const rows = await client.get<NewsRead[]>("content", `/news/club/${clubId}`);
          output(rows, opts.json, () =>
            Array.isArray(rows) && rows.length
              ? renderTable(rows, [
                  { header: "Titel", width: 36, get: (n) => String(n.title ?? "—") },
                  { header: "Quelle", width: 7, get: (n) => String(n.design_source ?? "webapp") },
                  { header: "Sicht", width: 11, get: (n) => String(n.visibility_scope ?? "—") },
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
            `${n.title ?? "—"} [${n.design_source ?? "webapp"}, ${n.visibility_scope ?? "?"}] — ${n.id}`,
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
          const created = await client.post<NewsRead>("content", `/news/club/${clubId}`, body);
          output(created, opts.json, () =>
            `News erstellt: ${created.id} (design_source=${created.design_source ?? "webapp"})`,
          );
          break;
        }

        case "update": {
          if (!id) throw new Error("news update <news-id> benoetigt eine News-ID.");
          // PUT ist Vollersatz — der Caller sollte alle relevanten Felder mitgeben.
          const body: Record<string, unknown> = {};
          if (opts.title) body.title = opts.title;
          if (opts.content) body.content = opts.content;
          if (opts.teaser) body.teaser = opts.teaser;
          if (opts.visibility) body.visibility_scope = opts.visibility;
          if (opts.designSource) body.design_source = opts.designSource;
          const updated = await client.put<NewsRead>("content", `/news/${id}`, body);
          output(updated, opts.json, () => `News aktualisiert: ${updated.id}`);
          break;
        }

        case "delete": {
          if (!id) throw new Error("news delete <news-id> benoetigt eine News-ID.");
          await client.del("content", `/news/${id}`);
          output({ deleted: id }, opts.json, () => `News geloescht: ${id}`);
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
          const applied = await client.post<NewsRead>("content", `/news/club/${clubId}`, payload);
          output(applied, opts.json, () =>
            `Rich-News erstellt (design_source=${applied.design_source}): ${applied.id}`,
          );
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, create, update, delete, apply`,
          );
      }
    });
}
