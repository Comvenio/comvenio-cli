import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";
import { writeFileSync } from "node:fs";
import { baumAlsText } from "../homepage/geruest.ts";
import type { SlotEntry } from "../homepage/geruest.ts";
import type { BulkTab, StyleEntry } from "../homepage/umwandeln.ts";
import { berichtAlsText, convert, geruestSet, HomepageAbbruch, liveAlsBulk, slotGet, slotSet, tree } from "../homepage/befehle.ts";

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
type HomeScreenshotResponse = {
  preview_id?: string;
  preview_url?: string;
  expires_at?: string;
  screenshots?: Array<{
    viewport?: string;
    width?: number;
    height?: number;
    mime_type?: string;
    data_base64?: string;
    bytes?: number;
  }>;
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
  ttlHours?: string;
  clear?: boolean;
  public?: boolean;
  open?: boolean;
  preview?: string;
  viewport?: string;
  tab?: string;
  settleMs?: string;
  out?: string;
  expectedVersion?: string;
  dryRun?: boolean;
  from?: string;
  styles?: string;
  stylesOut?: string;
  widget?: string;
};

/** Refusals of tree/slot/convert end with their own exit code (06 §4, DC-3). */
function abbrechen(err: HomepageAbbruch, json?: boolean): void {
  if (json) console.log(JSON.stringify({ fehler: err.code, meldung: err.message, daten: err.daten ?? null }, null, 2));
  console.error(`\nFehler (${err.code}): ${err.message}\n`);
  process.exitCode = err.exitCode;
}

export function parsePreviewTtlHours(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
    throw new Error("--ttl-hours muss eine ganze Zahl zwischen 1 und 24 sein.");
  }
  return hours;
}

export function addPreviewTtl(
  body: Record<string, unknown>,
  value?: string,
): void {
  const ttlHours = parsePreviewTtlHours(value);
  if (ttlHours !== undefined) body.ttl_hours = ttlHours;
}

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
const NL = String.fromCharCode(10);

export function registerHomepageCommands(cli: CAC): void {
  cli
    .command(
      "homepage <action> [...args]",
      "Homepage (deklarativ, kein Backend-LLM): preview | apply | show | export | screenshot | tree | slot get|set <reiter>/<slot> | geruest set <reiter> --widget <id> | convert — der Agent komponiert via schema homepage",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--file <path>", "home.json: vom Agenten komponierte Struktur (preview/apply)")
    .option("--design-file <path>", "preview: design_settings-JSON als versionierter No-Write-Snapshot")
    .option("--ttl-hours <hours>", "preview: Gueltigkeit in vollen Stunden (1-24; Standard: 30 Minuten)")
    .option("--clear", "apply: bestehende Homepage ersetzen (clear_existing)")
    .option("--public", "show: nur oeffentliche Struktur lesen")
    .option("--open", "preview: die Vorschau-URL im Standard-Browser oeffnen")
    .option("--preview <id>", "screenshot: die preview-id aus `homepage preview`")
    .option("--viewport <liste>", "screenshot: desktop, mobile oder beide (Vorgabe: desktop,mobile)")
    .option("--tab <slug>", "screenshot: ein bestimmter Reiter statt der Startseite")
    .option("--settle-ms <n>", "screenshot: Wartezeit nach dem Laden (Vorgabe 1500)")
    .option("--out <dir>", "screenshot: Bilder als Dateien ablegen; convert/export: Ausgabedatei (home.json)")
    .option("--expected-version <n>", "slot set / geruest set: erwartete Version des Gerüst-Widgets (sonst die gerade gelesene)")
    .option("--dry-run", "slot set / geruest set: Vorher/Nachher und Regelbefunde zeigen, nichts schreiben")
    .option("--widget <id>", "geruest set: das Gerüst-Widget (custom_html), dessen HTML --file ersetzt")
    .option("--from <path>", "convert: Bulk-Datei statt Live-Stand umwandeln")
    .option("--styles <path>", "convert: Stilkatalog (JSON-Liste); Katalogklassen wandern in den Slot-Stil (TD-16)")
    .option("--styles-out <path>", "convert: Vorschlag für den Stilkatalog aus den umgewandelten Klassen schreiben")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, args: string[], opts: Opts) => {
      const state = await loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "generate":
        case "design": {
          // Product doctrine: this CLI NEVER calls the backend LLM.
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
          addPreviewTtl(body, opts.ttlHours);
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

        case "screenshot": {
          // Rendert eine BEREITS angelegte Vorschau serverseitig zu Bildern.
          // Nicht zu verwechseln mit `comvenio verify homepage`: Das rendert
          // lokal ueber playwright-cli und legt Dateien ab — gedacht fuer einen
          // Agenten auf DIESEM Rechner. Hier rendert der club-service, und die
          // Bilder gehen denselben Weg wie jede andere Antwort. Nur so sieht
          // ein entferntes Modell (ChatGPT ueber MCP) sein Ergebnis.
          if (!opts.preview) {
            throw new Error("homepage screenshot benoetigt --preview <preview-id> (aus `homepage preview`).");
          }
          const viewports = (opts.viewport ?? "desktop,mobile")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          const res = await client.post<HomeScreenshotResponse>(
            "club",
            `/home-config/${clubId}/preview/${opts.preview}/screenshot`,
            {
              viewports,
              tab_slug: opts.tab ?? null,
              settle_ms: opts.settleMs ? Number(opts.settleMs) : 1500,
            },
          );
          const bilder = res.screenshots ?? [];
          // Ohne --out bleibt base64 in der Ausgabe: Ein Agent liest es direkt.
          // Mit --out landen Dateien auf der Platte, und die Ausgabe nennt die
          // Pfade statt der Daten — sonst stuende dasselbe Bild zweimal da.
          const geschrieben: string[] = [];
          if (opts.out) {
            const { mkdirSync, writeFileSync } = await import("node:fs");
            const { join } = await import("node:path");
            mkdirSync(opts.out, { recursive: true });
            for (const bild of bilder) {
              if (!bild.data_base64) continue;
              const endung = (bild.mime_type ?? "image/jpeg").split("/")[1] ?? "jpeg";
              const ziel = join(opts.out, `${opts.preview}-${bild.viewport ?? "abzug"}.${endung}`);
              writeFileSync(ziel, Buffer.from(bild.data_base64, "base64"));
              geschrieben.push(ziel);
            }
          }
          output(
            opts.out
              ? { ...res, screenshots: bilder.map(({ data_base64: _weg, ...rest }) => rest), files: geschrieben }
              : res,
            opts.json,
            () => {
              if (bilder.length === 0) return "Keine Abzuege erhalten.";
              const zeilen = bilder.map((b) =>
                `  ${(b.viewport ?? "?").padEnd(8)} ${b.width ?? "?"}x${b.height ?? "?"}  ${b.bytes ?? 0} Bytes`,
              );
              const dateien = geschrieben.length > 0
                ? `\nGeschrieben:\n${geschrieben.map((f) => `  ${f}`).join("\n")}`
                : "\n(ohne --out stehen die Bilder als base64 in der JSON-Ausgabe)";
              return `${bilder.length} Abzug(e) von ${res.preview_url ?? "?"}:\n${zeilen.join("\n")}${dateien}`;
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

        case "tree": {
          // Lastenheft 17-designer-struktur 06 §4.1: the designer's tree.
          try {
            const baeume = await tree(client, clubId, opts.tab);
            output({ tabs: baeume }, opts.json, () => baeume.map((b) => baumAlsText(b)).join("\n\n"));
          } catch (err) {
            if (err instanceof HomepageAbbruch) return abbrechen(err, opts.json);
            throw err;
          }
          break;
        }

        case "slot": {
          // 06 §4.2: `slot get <reiter>/<slot>` and `slot set <reiter>/<slot> --file entry.json`.
          const [unter, adresse] = args ?? [];
          try {
            if (unter === "get") {
              const stand = await slotGet(client, clubId, adresse ?? "");
              output(stand, opts.json, () =>
                `${stand.adresse} · Widget ${stand.widget_id} · Version ${stand.version}\n${JSON.stringify(stand.entry, null, 2)}`,
              );
            } else if (unter === "set") {
              if (!opts.file) throw new Error("homepage slot set benoetigt --file <entry.json> ({ kind, config, style? }).");
              const eintrag = readJsonFile<SlotEntry>(opts.file);
              const erwartet = opts.expectedVersion !== undefined ? Number(opts.expectedVersion) : undefined;
              if (erwartet !== undefined && (!Number.isInteger(erwartet) || erwartet < 1)) {
                throw new Error("--expected-version muss eine ganze Zahl ab 1 sein.");
              }
              const r = await slotSet(client, clubId, adresse ?? "", eintrag, { expectedVersion: erwartet, trockenlauf: !!opts.dryRun });
              output(r, opts.json, () => {
                const befunde = r.befunde.length
                  ? `\nBefunde:\n${r.befunde.map((b) => `  ${b.schwere} ${b.klasse}${b.slot ? ` (${b.slot})` : ""}`).join("\n")}`
                  : "";
                return `${r.geschrieben ? "Geschrieben" : "Trockenlauf — nichts geschrieben"}: ${adresse}${r.version ? ` (Version ${r.version})` : ""}\nvorher: ${JSON.stringify(r.vorher)}\nnachher: ${JSON.stringify(r.nachher)}${befunde}`;
              });
            } else {
              throw new Error('homepage slot erwartet "get <reiter>/<slot>" oder "set <reiter>/<slot> --file <entry.json>".');
            }
          } catch (err) {
            if (err instanceof HomepageAbbruch) return abbrechen(err, opts.json);
            throw err;
          }
          break;
        }

        case "geruest": {
          // 09 §4.6: replace the skeleton HTML of one widget, slots unchanged.
          const [unter, slug] = args ?? [];
          try {
            if (unter !== "set" || !slug) throw new Error('homepage geruest erwartet "set <reiter> --widget <id> --file <geruest.html>".');
            if (!opts.widget) throw new Error("homepage geruest set benoetigt --widget <id> (Gerüst-Widget aus homepage tree/export).");
            if (!opts.file) throw new Error("homepage geruest set benoetigt --file <geruest.html>.");
            const { readFileSync } = await import("node:fs");
            const html = readFileSync(opts.file, "utf8");
            const erwartet = opts.expectedVersion !== undefined ? Number(opts.expectedVersion) : undefined;
            if (erwartet !== undefined && (!Number.isInteger(erwartet) || erwartet < 1)) {
              throw new Error("--expected-version muss eine ganze Zahl ab 1 sein.");
            }
            const r = await geruestSet(client, clubId, slug, opts.widget, html, { expectedVersion: erwartet, trockenlauf: !!opts.dryRun });
            output(r, opts.json, () => {
              const kopf = r.geschrieben
                ? `Geschrieben: ${slug} · Widget ${r.widget_id} (Version ${r.version})`
                : r.unveraendert
                  ? `Unverändert: ${slug} · Widget ${r.widget_id} (Version ${r.version}) — nichts geschrieben`
                  : `Trockenlauf — nichts geschrieben: ${slug} · Widget ${r.widget_id} (Version ${r.version})`;
              const befunde = r.befunde.length
                ? `${NL}Befunde:${NL}${r.befunde.map((b) => `  ${b.schwere} ${b.klasse}${b.slot ? ` (${b.slot})` : ""}`).join(NL)}`
                : "";
              return `${kopf}${NL}HTML: ${r.vorher_zeichen} → ${r.nachher_zeichen} Zeichen${befunde}`;
            });
          } catch (err) {
            if (err instanceof HomepageAbbruch) return abbrechen(err, opts.json);
            throw err;
          }
          break;
        }

        case "convert": {
          // 06 §4.3: legacy skeleton → named slots, into a file. Applying stays
          // `homepage apply` after the human approved (07).
          if (!opts.out) throw new Error("homepage convert benoetigt --out <home.json>.");
          try {
            const quelle = opts.from
              ? { tabs: readJsonFile<{ tabs?: BulkTab[] }>(opts.from).tabs ?? [], hinweise: [] as string[] }
              : await liveAlsBulk(client, clubId);
            const styles = opts.styles ? readJsonFile<StyleEntry[]>(opts.styles) : undefined;
            const e = convert({ tabs: quelle.tabs }, { tab: opts.tab, styles });
            e.hinweise.push(...quelle.hinweise);
            writeFileSync(opts.out, JSON.stringify(e.home, null, 2));
            if (opts.stylesOut) writeFileSync(opts.stylesOut, JSON.stringify(e.katalog, null, 2));
            output(
              { datei: opts.out, katalog: opts.stylesOut ?? null, berichte: e.berichte, hinweise: e.hinweise },
              opts.json,
              () => `${berichtAlsText(e)}\nGeschrieben: ${opts.out}${opts.stylesOut ? `, ${opts.stylesOut}` : ""}\nNächster Schritt: homepage preview --file ${opts.out}`,
            );
          } catch (err) {
            if (err instanceof HomepageAbbruch) return abbrechen(err, opts.json);
            throw err;
          }
          break;
        }

        case "export": {
          // Full live structure in bulk format (tabs → sections → widgets), the
          // backup before a conversion (07 §4.1): `homepage apply --file <out> --clear`
          // restores it. `show` lists only the tabs.
          if (!opts.out) throw new Error("homepage export benoetigt --out <home.json>.");
          const { tabs, hinweise } = await liveAlsBulk(client, clubId);
          writeFileSync(opts.out, JSON.stringify({ tabs }, null, 2));
          const sektionen = tabs.reduce((n, t) => n + t.sections.length, 0);
          const widgets = tabs.reduce((n, t) => n + t.sections.reduce((m, s) => m + s.widgets.length, 0), 0);
          output({ datei: opts.out, reiter: tabs.length, sektionen, widgets, hinweise }, opts.json, () =>
            [`Geschrieben: ${opts.out} — ${tabs.length} Reiter, ${sektionen} Sektionen, ${widgets} Widgets`, ...hinweise.map((h) => `Hinweis: ${h}`)].join(NL),
          );
          break;
        }

        default:
          throw new Error(`Unbekannte Aktion "${action}". Verfuegbar: preview, screenshot, apply, show, export, tree, slot, geruest, convert (generate/design entfernt — Agent komponiert deklarativ)`);
      }
    });
}
