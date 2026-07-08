import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

// KI-Gen Homepage (verified Sub-File 09). TWO modes (D-12):
//   generative `homepage generate --prompt` → ai /club-homepage/generate (auto_apply
//              persists itself via club-service bulk — CLI must NOT call bulk too)
//   declarative `homepage apply --file home.json` → club /home-config/{club_id}/bulk
//              directly (BulkCreateRequest), NO ai-service
//   `homepage show [--public]` → club home-config/tabs OR public/clubs/{id}/home
//   `homepage design --prompt` → ai /club-design/generate (recommendation only, no apply)
// gateway keys: "ai" → ai-service, "club" → club-service.

type HomepageGenerateResponse = {
  config?: { tabs?: unknown[] };
  explanation?: string;
  suggestions?: string[];
  session_id?: string;
};
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
  prompt?: string;
  template?: string;
  widgets?: string;
  file?: string;
  apply?: boolean;
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
 *   homepage generate --prompt "..." [--template t] [--widgets a,b] [--apply]
 *   homepage preview --file home.json [--open]
 *   homepage apply --file home.json [--clear]
 *   homepage show [--public]
 *   homepage design --prompt "..."
 *
 * Empfohlener Flow: schema homepage (komponieren) → preview --file (ansehen)
 *   → apply --file (live schalten).
 */
export function registerHomepageCommands(cli: CAC): void {
  cli
    .command("homepage <action>", "KI-Homepage: generate (KI) | preview (Vorschau) | apply (deklarativ) | show | design")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--prompt <text>", "Beschreibung (min. 5 Zeichen, generate/design)")
    .option("--template <name>", "elegance|sport|community|minimal|festlich|modern|classic")
    .option("--widgets <list>", "Komma-Liste gewuenschter Widget-Kinds (generate)")
    .option("--file <path>", "home.json: vom Agenten komponierte Struktur (preview/apply)")
    .option("--apply", "generate: direkt anwenden (auto_apply, ersetzt Homepage)")
    .option("--clear", "apply: bestehende Homepage ersetzen (clear_existing)")
    .option("--public", "show: nur oeffentliche Struktur lesen")
    .option("--open", "preview: die Vorschau-URL im Standard-Browser oeffnen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "generate": {
          if (!opts.prompt || opts.prompt.length < 5) {
            throw new Error("homepage generate benoetigt --prompt (min. 5 Zeichen).");
          }
          const body: Record<string, unknown> = {
            club_id: clubId,
            prompt: opts.prompt,
            auto_apply: !!opts.apply,
          };
          if (opts.template) body.template_id = opts.template;
          if (opts.widgets) {
            body.selected_widgets = opts.widgets.split(",").map((s) => s.trim()).filter(Boolean);
          }
          // synchronous; at auto_apply the ai-service persists via club-service bulk itself.
          // LLM generation legitimately runs 30-120s — long per-request timeout
          // (default 15s aborts it, E2E-Befund K9 2026-07-08).
          const res = await client.post<HomepageGenerateResponse>(
            "ai",
            "/club-homepage/generate?streaming=false",
            body,
            { timeoutMs: 180_000 },
          );
          output(
            {
              applied: !!opts.apply,
              tabs: res.config?.tabs?.length ?? 0,
              explanation: res.explanation,
              config: res.config,
              suggestions: res.suggestions,
            },
            opts.json,
            () =>
              [
                `${opts.apply ? "Homepage angewendet" : "Vorschlag (nicht angewendet)"}: ${res.config?.tabs?.length ?? 0} Tabs.`,
                res.explanation ?? "",
              ]
                .filter(Boolean)
                .join("\n"),
          );
          break;
        }

        case "preview": {
          // Pixel-exact preview BEFORE apply: POST the same composed structure as
          // `apply --file` to the preview endpoint, which returns a short-lived
          // preview URL (no live mutation of the homepage). Body = BulkCreateRequest.
          if (!opts.file) {
            throw new Error("homepage preview benoetigt --file <home.json> (vom Agenten komponierte Struktur).");
          }
          const struct = readJsonFile<{ tabs?: unknown[]; clear_existing?: boolean } | unknown[]>(opts.file);
          const tabs = Array.isArray(struct) ? struct : (struct.tabs ?? []);
          if (!Array.isArray(tabs) || tabs.length === 0) {
            throw new Error("home.json braucht mindestens einen Tab (tabs[]).");
          }
          // Mirror the apply body shape (BulkCreateRequest): tabs + optional clear_existing.
          const body: Record<string, unknown> = { tabs };
          if (!Array.isArray(struct) && struct.clear_existing !== undefined) {
            body.clear_existing = struct.clear_existing;
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

        case "design": {
          if (!opts.prompt || opts.prompt.length < 5) {
            throw new Error("homepage design benoetigt --prompt (min. 5 Zeichen).");
          }
          // Recommendation only — no auto-apply (Sub-File 09 offener Punkt P-1).
          const res = await client.post<Record<string, unknown>>(
            "ai",
            "/club-design/generate?streaming=false",
            { club_id: clubId, prompt: opts.prompt },
            { timeoutMs: 180_000 },
          );
          output(res, opts.json, () =>
            `Design-Empfehlung erhalten (reine Empfehlung, nicht persistiert).`,
          );
          break;
        }

        default:
          throw new Error(`Unbekannte Aktion "${action}". Verfuegbar: generate, preview, apply, show, design`);
      }
    });
}
