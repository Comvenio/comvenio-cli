import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

// Homepage is declarative (D-12): the operating agent composes JSON from the
// schema, previews it, and applies it directly through club-service.
// The CLI never calls the backend LLM.
//   `homepage show [--public]` → club home-config/tabs OR public/clubs/{id}/home
// gateway key: "club" → club-service.
type BulkCreateResponse = {
  tabs?: unknown[];
  sections_created?: number;
  widgets_created?: number;
};
type HomePreviewResponse = {
  preview_id?: string;
  preview_url?: string;
  expires_at?: string;
};
type ClubHomeTabRead = {
  id?: string;
  label?: string;
  slug?: string;
  position?: number;
  visibility_scope?: string;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
  file?: string;
  designFile?: string;
  clear?: boolean;
  public?: boolean;
  open?: boolean;
};

/**
 * Open a URL in the platform default browser (best-effort). Windows uses
 * `cmd /c start`, macOS `open`, Linux `xdg-open`. Failures are swallowed — the
 * caller has already printed the URL, so the user/agent can open it manually.
 */
async function openInBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  // Windows `start` is a cmd builtin; the empty "" is the (ignored) window title.
  const cmd =
    platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * `comvenio homepage <action>` dispatcher (cac multi-word via dispatcher).
 *   homepage preview --file home.json [--open]
 *   homepage apply --file home.json [--clear]
 *   homepage show [--public]
 *
 * Empfohlener Flow: schema homepage (komponieren) → preview --file (ansehen)
 *   → apply --file (live schalten).
 */
export function registerHomepageCommands(cli: CAC): void {
  cli
    .command("homepage <action>", "Homepage (deklarativ, kein Backend-LLM): preview (Vorschau) | apply | show — der Agent komponiert via schema homepage")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "home.json: vom Agenten komponierte Struktur (preview/apply)")
    .option("--design-file <path>", "preview: design_settings-JSON als versionierter No-Write-Snapshot")
    .option("--clear", "apply: bestehende Homepage ersetzen (clear_existing)")
    .option("--public", "show: nur oeffentliche Struktur lesen")
    .option("--open", "preview: die Vorschau-URL im Standard-Browser oeffnen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "generate":
        case "design": {
          // Doctrine (Tom 2026-07-08): this CLI NEVER calls the backend LLM.
          // The operating agent (Claude/Codex) IS the intelligence and composes
          // declaratively — that is the whole point of the CLI.
          throw new Error(
            [
              `"homepage ${action}" wurde entfernt: Das CLI ruft NIEMALS das Backend-LLM — der bedienende Agent komponiert selbst.`,
              "Deklarativer Weg:",
              "  1) comvenio schema homepage          — gueltige Widget-Kinds/Layouts/Enums",
              "  2) home.json komponieren             — Tabs/Sections/Widgets als JSON",
              "  3) comvenio homepage preview --file home.json [--open]",
              "  4) comvenio homepage apply --file home.json [--clear]",
              "Design-Settings direkt setzen: comvenio club design",
            ].join("\n"),
          );
        }

        case "preview": {
          // Pixel-exact preview BEFORE apply: POST the same composed structure as
          // `apply --file` to the preview endpoint, which returns a short-lived
          // preview URL (no live mutation of the homepage). Body = BulkCreateRequest.
          if (!opts.file) {
            throw new Error("homepage preview benoetigt --file <home.json> (vom Agenten komponierte Struktur).");
          }
          const struct = readJsonFile<{
            tabs?: unknown[];
            clear_existing?: boolean;
            design_settings?: Record<string, unknown>;
          } | unknown[]>(opts.file);
          const tabs = Array.isArray(struct) ? struct : (struct.tabs ?? []);
          if (!Array.isArray(tabs) || tabs.length === 0) {
            throw new Error("home.json braucht mindestens einen Tab (tabs[]).");
          }
          // Mirror the apply body shape (BulkCreateRequest): tabs + optional clear_existing.
          const body: Record<string, unknown> = { tabs };
          if (!Array.isArray(struct) && struct.clear_existing !== undefined) {
            body.clear_existing = struct.clear_existing;
          }
          const designSettings = opts.designFile
            ? readJsonFile<Record<string, unknown>>(opts.designFile)
            : !Array.isArray(struct)
              ? struct.design_settings
              : undefined;
          if (designSettings) {
            body.design_snapshot_version = 1;
            body.design_settings = designSettings;
          }
          const res = await client.post<HomePreviewResponse>(
            "club",
            `/home-config/${clubId}/preview`,
            body,
          );
          const url = res.preview_url ?? "";
          let opened = false;
          if (opts.open && url) {
            opened = await openInBrowser(url);
          }
          output(
            { ...res, opened: opts.open ? opened : undefined },
            opts.json,
            () => {
              if (!url) return "Keine Vorschau-URL erhalten.";
              const expiry = res.expires_at ? ` (gueltig bis ${res.expires_at})` : "";
              const openHint = opts.open
                ? opened
                  ? "\nIm Browser geoeffnet."
                  : "\nBrowser konnte nicht automatisch geoeffnet werden — URL manuell oeffnen."
                : "";
              return `Vorschau: ${url}${expiry}${openHint}`;
            },
          );
          break;
        }

        case "apply": {
          // Declarative (D-12): agent composes tabs/sections/widgets, CLI posts to bulk.
          if (!opts.file) {
            throw new Error("homepage apply benoetigt --file <home.json> (vom Agenten komponierte Struktur).");
          }
          const struct = readJsonFile<{ tabs?: unknown[] } | unknown[]>(opts.file);
          const tabs = Array.isArray(struct) ? struct : (struct.tabs ?? []);
          if (!Array.isArray(tabs) || tabs.length === 0) {
            throw new Error("home.json braucht mindestens einen Tab (tabs[]).");
          }
          const body = { clear_existing: !!opts.clear, tabs };
          // NO ai-service — direct to the club-service bulk endpoint.
          const res = await client.post<BulkCreateResponse>(
            "club",
            `/home-config/${clubId}/bulk`,
            body,
          );
          output(
            {
              applied: true,
              cleared: !!opts.clear,
              tabs: res.tabs?.length ?? 0,
              sections: res.sections_created ?? 0,
              widgets: res.widgets_created ?? 0,
            },
            opts.json,
            () =>
              `Homepage angewendet${opts.clear ? " (ersetzt)" : " (additiv)"}: ${res.tabs?.length ?? 0} Tabs, ${res.sections_created ?? 0} Sektionen, ${res.widgets_created ?? 0} Widgets.`,
          );
          break;
        }

        case "show": {
          const path = opts.public
            ? `/public/clubs/${clubId}/home`
            : `/home-config/${clubId}/tabs`;
          const tabs = await client.get<ClubHomeTabRead[]>("club", path);
          output(tabs, opts.json, () =>
            Array.isArray(tabs) && tabs.length
              ? renderTable(tabs, [
                  { header: "Label", width: 20, get: (t) => String(t.label ?? "—") },
                  { header: "Slug", width: 18, get: (t) => String(t.slug ?? "—") },
                  { header: "Pos", width: 4, get: (t) => String(t.position ?? "") },
                  { header: "Scope", width: 12, get: (t) => String(t.visibility_scope ?? "—") },
                ])
              : "Keine Tabs.",
          );
          break;
        }

        default:
          throw new Error(`Unbekannte Aktion "${action}". Verfuegbar: preview, apply, show (generate/design entfernt — Agent komponiert deklarativ)`);
      }
    });
}
