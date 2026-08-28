#!/usr/bin/env bun
/**
 * gen:schema — Generate `comvenio schema <domain> --json` data from the REAL
 * code sources instead of hand-maintained constants. Guards against drift:
 * when someone changes a source (widget registry, an enum, a TS type), the
 * committed `src/schema/*.json` no longer matches and `--check` fails on CI.
 *
 * Run:
 *   bun run scripts/gen-schema.ts          # regenerate src/schema/*.json
 *   bun run scripts/gen-schema.ts --check  # CI: fail (exit 1) if drift
 *
 * Workspace root resolution (no hard-coded absolute paths):
 *   1. process.env.COMVENIO_WORKSPACE  (if set)
 *   2. ../  relative to comvenio-cli   (= E:\Comvenio\Sourcecode by default)
 *
 * Parsing is regex-based on purpose: the sources are flat (TS string-union
 * types, Python `str, Enum` classes, a registry object literal, prompt lines).
 * No heavy AST framework needed — but the regexes are tolerant of whitespace
 * and comments so they survive source reformatting.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, "..");
const SCHEMA_DIR = join(CLI_ROOT, "src", "schema");

/** Workspace root: env override, else one level above comvenio-cli. */
const WORKSPACE = process.env.COMVENIO_WORKSPACE
  ? resolve(process.env.COMVENIO_WORKSPACE)
  : resolve(CLI_ROOT, "..");

const CHECK_MODE = process.argv.includes("--check");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a workspace-relative path and read it, or throw a clear error. */
function readSource(relPath: string): string {
  const aiPrefix = "Backend/Microservice-Backend/ai-service/";
  const abs = process.env.COMVENIO_AI_SERVICE_ROOT && relPath.startsWith(aiPrefix)
    ? join(resolve(process.env.COMVENIO_AI_SERVICE_ROOT), relPath.slice(aiPrefix.length))
    : join(WORKSPACE, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `Quelle nicht gefunden: ${relPath}\n` +
        `  erwartet unter: ${abs}\n` +
        `  Workspace-Root: ${WORKSPACE}\n` +
        `  Setze COMVENIO_WORKSPACE bzw. COMVENIO_AI_SERVICE_ROOT fuer isolierte Worktrees.`,
    );
  }
  return readFileSync(abs, "utf8");
}

/** Forward-slash the relative source paths so the "source" field is OS-stable. */
function slash(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Extract the string members of a Python `class X(str, enum.Enum)` / `(str, PyEnum)`
 * block. Matches `name = "value"` lines until dedent to the next class/def.
 */
function parsePyEnum(source: string, className: string): string[] {
  // Grab the class body (from the class header to the next top-level `class `/`def `).
  const headerRe = new RegExp(
    `class\\s+${className}\\s*\\([^)]*\\b(?:str\\s*,\\s*)?(?:enum\\.Enum|PyEnum|Enum)\\b[^)]*\\)\\s*:`,
  );
  const m = headerRe.exec(source);
  if (!m) {
    throw new Error(`Python-Enum "${className}" nicht in der Quelle gefunden.`);
  }
  const rest = source.slice(m.index + m[0].length);
  // Body ends at the next line that starts a new top-level class/def (no indent).
  const endRe = /\n(?=class\s|def\s|@)/;
  const endMatch = endRe.exec(rest);
  const body = endMatch ? rest.slice(0, endMatch.index) : rest;

  // Members: `member = "value"` (value is the authoritative wire form).
  const values: string[] = [];
  const memberRe = /^\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']([^"']+)["']/gm;
  let mm: RegExpExecArray | null;
  while ((mm = memberRe.exec(body)) !== null) {
    values.push(mm[1]);
  }
  if (values.length === 0) {
    throw new Error(`Python-Enum "${className}" hat keine String-Member.`);
  }
  return values;
}

// ─── Domain: homepage ────────────────────────────────────────────────────────

const HOMEPAGE_REGISTRY = "Frontend/web-page/src/components/ClubHome/widgets/index.ts";
const HOMEPAGE_PROMPT =
  "Backend/Microservice-Backend/ai-service/app/prompts/homepage_system.py";
const HOMEPAGE_SECTION_SCHEMA =
  "Backend/Microservice-Backend/club-service/app/schemas/club_home_section.py";
const HOMEPAGE_WIDGET_KINDS =
  "Backend/Microservice-Backend/club-service/app/constants/widget_kinds.py";
const HOMEPAGE_WIDGET_DIR =
  "Frontend/web-page/src/components/ClubHome/widgets";

/** Authoritative widget kinds: keys of WIDGET_REGISTRY (one per line). */
function parseWidgetKinds(registrySrc: string): string[] {
  // Isolate the WIDGET_REGISTRY object literal so we don't catch the import map.
  const start = registrySrc.indexOf("export const WIDGET_REGISTRY");
  if (start === -1) throw new Error("WIDGET_REGISTRY nicht in index.ts gefunden.");
  const body = registrySrc.slice(start);
  // `  kind: SomeWidget,` — kind is a snake_case identifier, value a Component.
  const kindRe = /^\s+([a-z][a-z0-9_]*)\s*:\s*[A-Za-z][A-Za-z0-9_]*\s*,/gm;
  const kinds: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = kindRe.exec(body)) !== null) {
    kinds.push(m[1]);
  }
  if (kinds.length === 0) throw new Error("Keine Widget-kinds aus WIDGET_REGISTRY geparst.");
  return kinds;
}

function parsePromptWidgetKinds(promptSrc: string): string[] {
  const start = promptSrc.indexOf("## Verfuegbare Widget-Typen");
  const end = promptSrc.indexOf("## Design-Presets fuer Widgets", start);
  if (start === -1 || end === -1) throw new Error("Widget-Sektion im Homepage-Prompt fehlt.");
  return [...promptSrc.slice(start, end).matchAll(/^\s*-\s+([a-z][a-z0-9_]*)\s*:/gm)]
    .map((match) => match[1]);
}

function parsePythonStringSet(source: string, name: string): string[] {
  const start = source.indexOf(`${name}:`);
  if (start === -1) throw new Error(`Python-Set ${name} nicht gefunden.`);
  const bodyStart = source.indexOf("frozenset(", start);
  const bodyEnd = source.indexOf("\n)", bodyStart);
  if (bodyStart === -1 || bodyEnd === -1) throw new Error(`Python-Set ${name} nicht abschliessbar.`);
  return [...source.slice(bodyStart, bodyEnd).matchAll(/["']([a-z][a-z0-9_-]*)["']/g)]
    .map((match) => match[1]);
}

function parsePythonLiteral(source: string, name: string): string[] {
  const match = new RegExp(`${name}\\s*=\\s*Literal\\s*\\[([\\s\\S]*?)\\]`).exec(source);
  if (!match) throw new Error(`Python-Literal ${name} nicht gefunden.`);
  return [...match[1].matchAll(/["']([a-z][a-z0-9_-]*)["']/g)].map((entry) => entry[1]);
}

/**
 * Map each widget kind to the source file that actually implements it, by
 * following the registry's own imports. Used to answer one question per config
 * field: does the widget read this at all?
 */
function parseWidgetSources(registrySrc: string): Record<string, string> {
  const componentToFile: Record<string, string> = {};
  const importRe =
    /import\s+(?:\{\s*([^}]+?)\s*\}|([A-Za-z][A-Za-z0-9_]*))\s+from\s+"\.\/([^"]+)"/g;
  for (const m of registrySrc.matchAll(importRe)) {
    const names = m[1]
      ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())
      : [m[2]!];
    for (const name of names) componentToFile[name] = m[3];
  }

  const out: Record<string, string> = {};
  const start = registrySrc.indexOf("export const WIDGET_REGISTRY");
  const body = start === -1 ? "" : registrySrc.slice(start);
  for (const m of body.matchAll(/^\s+([a-z][a-z0-9_]*)\s*:\s*([A-Za-z][A-Za-z0-9_]*)\s*,/gm)) {
    const file = componentToFile[m[2]];
    if (file) out[m[1]] = file;
  }
  return out;
}

/**
 * Which documented config fields does the widget source never mention?
 *
 * A HINT, not a verdict — and deliberately so. The check errs towards silence:
 * a bare word match counts, so a field named like a common identifier (`style`,
 * `title`) passes even when the widget means something else by it. What it DOES
 * catch is the expensive case: a field the implementation has no idea about, so
 * configuring it does nothing and nobody is told.
 *
 * Discovered 2026-08-27 on `ticker`, where the prompt documents
 * `background_color`/`text_color` and the widget reads neither. The measurement
 * that followed found 27 of 69 widgets carrying at least one such field, and
 * `divider` matching in not a single one.
 */
function configFieldsNotInSource(
  fields: Array<{ name: string }>,
  source: string,
): string[] {
  return fields
    .map((f) => f.name)
    .filter((name) => !new RegExp(`\\b${name}\\b`).test(source));
}

/**
 * Which documented value sets does the widget contradict?
 *
 * `config_not_read_by_widget` compares field NAMES. It says nothing about the
 * values, and that is where the second half of the drift sat: `team`
 * documented `layout: card|compact|org` while the widget knows
 * `grid|carousel|spotlight`, and `stats` had all three values wrong. Setting
 * one of them silently yields the default — no error anywhere.
 *
 * The value set is read two ways, both syntactic:
 *   `feld?: "a" | "b";`             inline union in the config interface
 *   `type X = "a" | "b"; feld?: X;` via a type alias
 * Anything not found either way yields NO finding. A checker that fires on
 * every uncertainty gets ignored, and then it protects nothing.
 */
function documentedValuesNotInSource(
  fields: Array<{ name: string; values?: string[] }>,
  source: string,
  zaehler?: { gelesen: number; nichtLesbar: number },
): Array<{ field: string; unknown: string[] }> {
  const union = (expr: string): string[] | null => {
    const parts = [...expr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return parts.length >= 2 ? parts : null;   // a lone string is not a set
  };

  const out: Array<{ field: string; unknown: string[] }> = [];
  for (const field of fields) {
    if (!Array.isArray(field.values) || field.values.length === 0) continue;

    let known: string[] | null = null;
    const inline = new RegExp(`\\b${field.name}\\??:\\s*("[^;\\n]+")\\s*;`).exec(source);
    if (inline) known = union(inline[1]);
    if (!known) {
      const viaAlias = new RegExp(`\\b${field.name}\\??:\\s*([A-Z][A-Za-z0-9_]*)\\s*;`).exec(source);
      if (viaAlias) {
        const alias = new RegExp(`type\\s+${viaAlias[1]}\\s*=\\s*([^;]+);`).exec(source);
        if (alias) known = union(alias[1]);
      }
    }
    if (!known) {
      // Ehrlich zaehlen statt still uebergehen: Ein Pruefer muss sagen, was er
      // NICHT angesehen hat, sonst liest sich seine Null wie eine Entwarnung.
      if (zaehler) zaehler.nichtLesbar += 1;
      continue;
    }
    if (zaehler) zaehler.gelesen += 1;

    const unknown = field.values.filter((v) => !known!.includes(v));
    if (unknown.length > 0) out.push({ field: field.name, unknown });
  }
  return out;
}

/**
 * Parse `Config:`/`(...)` field hints out of the homepage system prompt.
 * The prompt lists widgets as bullet lines, where the description (and the
 * `Config:` segment) may wrap onto following indented continuation lines:
 *   `- <kind>: <desc>. Config: feld1, feld2: a|b, ...`
 *   `- <kind>: <desc> (feld1, feld2: a|b)`
 *   `- hero: <warning text>\n    Config: headline, subtitle, bg_type: a|b, ...`
 * Returns kind -> array of { name, values? } config fields.
 * Not all 68 kinds are documented here (Phase-4 widgets lack a prompt entry).
 */
function parsePromptConfigs(promptSrc: string): Record<
  string,
  Array<{ name: string; values?: string[] }>
> {
  const out: Record<string, Array<{ name: string; values?: string[] }>> = {};
  const lines = promptSrc.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const bullet = /^-\s+([a-z][a-z0-9_]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!bullet) continue;
    const kind = bullet[1];

    // Join the bullet with its indented continuation lines (until the next
    // bullet, a markdown header, or a blank line) so a wrapped `Config:` is seen.
    let blob = bullet[2];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^-\s+[a-z]/.test(next) || /^#/.test(next) || next.trim() === "") break;
      // Continuation lines are indented; fold them into one descriptive blob.
      blob += " " + next.trim();
    }

    // Prefer the explicit `Config:` segment (authoritative field list).
    let fieldsBlob: string | null = null;
    const cfgIdx = blob.search(/\bConfig\s*:/i);
    if (cfgIdx !== -1) {
      fieldsBlob = blob.slice(cfgIdx).replace(/^.*?Config\s*:/i, "").trim();
    } else {
      // No `Config:` → try the first parenthesised group, but ONLY if it looks
      // like a field list (snake_case tokens / `name: a|b` enums), not prose.
      const paren = /\(([^()]*)\)/.exec(blob);
      if (paren && looksLikeFieldList(paren[1])) fieldsBlob = paren[1].trim();
    }
    if (!fieldsBlob) continue;

    const fields = parseFieldBlob(fieldsBlob);
    if (fields.length > 0) out[kind] = fields;
  }
  return out;
}

/**
 * Heuristic: does a parenthetical look like a config field list rather than a
 * prose note? True when it contains a `name: opt|opt` enum, OR at least two
 * snake_case/lower tokens that are not obvious German prose words.
 */
function looksLikeFieldList(s: string): boolean {
  if (/[a-z_]+\s*:\s*[a-z0-9_-]+\s*\|/i.test(s)) return true; // has an enum field
  // Reject typical prose markers.
  if (/\b(in Entwicklung|Platzhalter|verfuegbar|nur als)\b/i.test(s)) return false;
  const tokens = s.split(",").map((t) => t.trim());
  const fieldish = tokens.filter((t) => /^[a-z][a-z0-9_]*$/i.test(t));
  return fieldish.length >= 2;
}

/**
 * Split a `feld1, feld2: a|b, feld3 (px, default 260)` blob into structured
 * fields. A field is a token; if it has `: a|b|c` it carries enum values.
 * Tolerant of trailing notes in parentheses.
 */
function parseFieldBlob(blob: string): Array<{ name: string; values?: string[] }> {
  // Strip trailing sentence punctuation and surrounding noise.
  let s = blob.trim().replace(/[.;]+\s*$/, "");
  // Remove bracketed sub-structures like `[{time, title, description}]` (item
  // shapes) and note-parens like `(px, default 260)` — their inner commas would
  // otherwise leak as bogus fields. Keep top-level enum pipes (`name: a|b`).
  s = s.replace(/\[[^\]]*\]/g, "");
  s = s.replace(/\{[^}]*\}/g, "");
  s = s.replace(/\([^)]*\)/g, "");
  const fields: Array<{ name: string; values?: string[] }> = [];
  // Split on commas that separate fields. Enum option lists use `|` not `,`.
  for (const rawPart of s.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    // `name: a|b|c`  → field with enum values
    const enumM = /^([a-z][a-z0-9_]*)\s*:\s*([a-z0-9_|\s-]+)$/i.exec(part);
    if (enumM && enumM[2].includes("|")) {
      const name = enumM[1];
      const values = enumM[2]
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean);
      if (!fields.some((f) => f.name === name)) fields.push({ name, values });
      continue;
    }
    // bare `name` (possibly `name: true/false` style → just the name)
    const nameM = /^([a-z][a-z0-9_]*)/i.exec(part);
    if (nameM) {
      const name = nameM[1];
      if (!fields.some((f) => f.name === name)) fields.push({ name });
    }
  }
  return fields;
}

/** Parse section layout/style_variant + tab visibility_scope from the model comments. */
function parseSectionEnums(sectionSrc: string): {
  layout: string[];
  style_variant: string[];
} {
  return {
    layout: parsePythonLiteral(sectionSrc, "SectionLayout"),
    style_variant: parsePythonLiteral(sectionSrc, "SectionStyleVariant"),
  };
}

function genHomepage(): unknown {
  const existingPath = join(SCHEMA_DIR, "homepage.json");
  const existing = existsSync(existingPath)
    ? JSON.parse(readFileSync(existingPath, "utf8")) as Record<string, any>
    : {};
  const registrySrc = readSource(HOMEPAGE_REGISTRY);
  const promptSrc = readSource(HOMEPAGE_PROMPT);
  const sectionSrc = readSource(HOMEPAGE_SECTION_SCHEMA);
  const backendKindsSrc = readSource(HOMEPAGE_WIDGET_KINDS);

  const kinds = parseWidgetKinds(registrySrc);
  const promptConfigs = parsePromptConfigs(promptSrc);
  const promptKinds = parsePromptWidgetKinds(promptSrc);
  const backendKinds = parsePythonStringSet(backendKindsSrc, "VALID_WIDGET_KINDS");
  const sectionEnums = parseSectionEnums(sectionSrc);

  // Hold the documented config against the implementation. The kinds have had a
  // sync check since day one (vocabulary_sync below); the FIELDS never did, and
  // that is where the drift sat unseen.
  const widgetSources = parseWidgetSources(registrySrc);
  const nichtImCode: Record<string, string[]> = {};
  const werteNichtImCode: Record<string, Array<{ field: string; unknown: string[] }>> = {};
  const werteZaehler = { gelesen: 0, nichtLesbar: 0 };
  let felderGeprueft = 0;
  let widgetsGeprueft = 0;
  for (const [kind, file] of Object.entries(widgetSources)) {
    const fields = promptConfigs[kind];
    if (!fields || fields.length === 0) continue;
    let src: string;
    try {
      src = readSource(`${HOMEPAGE_WIDGET_DIR}/${file}.tsx`);
    } catch {
      continue; // Kein lesbarer Quelltext -> keine Aussage, kein Hinweis.
    }
    widgetsGeprueft += 1;
    felderGeprueft += fields.length;
    const fehlend = configFieldsNotInSource(fields, src);
    if (fehlend.length > 0) nichtImCode[kind] = fehlend;

    // Zweite Haelfte: Der Feldname kann stimmen und die Wertemenge trotzdem
    // erfunden sein. `stats` dokumentierte layout: card|bold|minimal, das
    // Widget kennt grid|horizontal|bento — kein einziger Wert traf, und wer
    // einen davon setzt, bekommt wortlos den Default.
  }

  // Fall back to the documented value sets if comment-parsing yields nothing.
  const layout =
    sectionEnums.layout.length > 0
      ? sectionEnums.layout
      : ["full", "two-col", "three-col", "four-col", "sidebar-left", "sidebar-right", "asymmetric-left", "asymmetric-right"];
  const style_variant =
    sectionEnums.style_variant.length > 0
      ? sectionEnums.style_variant
      : ["default", "primary", "dark", "subtle", "gradient", "glass", "image"];

  // Build per-widget config from the prompt. Kinds without a prompt entry get
  // `config: []` (honest: their config schema is not documented in the prompt).
  const widgets: Record<string, { config: Array<{ name: string; values?: string[] }> }> = {};
  let documented = 0;
  for (const kind of kinds) {
    const cfg = promptConfigs[kind];
    if (cfg && cfg.length > 0) {
      widgets[kind] = { config: cfg };
      documented += 1;
    } else {
      widgets[kind] = { config: [] };
    }
  }

  // Die Felder kommen aus dem Prompt, sobald er welche nennt; alles andere am
  // Eintrag (status, handgepflegte Notizen) bleibt stehen.
  //
  // Vorher gewannen bestehende Eintraege VOLLSTAENDIG, und damit schrieb der
  // Generator die config eines Widgets genau einmal — beim ersten Auftreten,
  // danach nie wieder. Genau daran konnte die Drift wachsen, ohne dass ein
  // Lauf sie je eingeholt haette: Am 2026-08-27 nannte das Schema fuer `ticker`
  // background_color und text_color, obwohl beide seit Langem weder im Prompt
  // noch im Widget standen. Ein Generator, der eine Quelle liest und ihr
  // Ergebnis dann verwirft, ist keiner.
  const mergedWidgets = Object.fromEntries(kinds.map((kind) => {
    const bestehend = (existing.widgets?.[kind] ?? {}) as Record<string, any>;
    const ausPrompt = widgets[kind].config;

    // Je Feld gewinnt der Prompt (Name, Werte), aber handgepflegte Zusaetze am
    // gleichnamigen Feld bleiben. Noetig, weil der Prompt-Parser `widgetId
    // Pflicht` als required erkennt, `club_name (Pflicht)` in Klammern aber
    // nicht — ohne diesen Erhalt verlieren solche Felder ihr required.
    // Ein Feld, das aus dem Prompt verschwunden ist, faellt weg. Genau das
    // ist der Zweck.
    const vorhanden = new Map<string, any>(
      ((bestehend.config ?? []) as Array<{ name: string }>).map((f) => [f.name, f]),
    );
    const config = ausPrompt.length > 0
      ? ausPrompt.map((f) => ({ ...(vorhanden.get(f.name) ?? {}), ...f }))
      : (bestehend.config ?? []);

    return [kind, { ...bestehend, config }];
  }));

  // Nach dem Merge, nicht davor: Bestehende Widget-Eintraege werden oben
  // bewusst uebernommen statt neu gebaut. Wer den Hinweis vorher setzt,
  // schreibt ihn nur fuer neue Kinds — und genau die alten sind die
  // interessanten, weil ihre Drift schon da ist.
  for (const [kind, eintrag] of Object.entries(mergedWidgets)) {
    const fehlend = nichtImCode[kind];
    if (fehlend && fehlend.length > 0) {
      (eintrag as Record<string, unknown>).config_not_read_by_widget = fehlend;
    } else {
      delete (eintrag as Record<string, unknown>).config_not_read_by_widget;
    }

    // Die Wertepruefung sitzt NACH dem Merge, nicht davor: Geprueft gehoert,
    // was das Schema behauptet — und das sind die gemergten Felder, nicht die
    // aus dem Prompt. Handgepflegte Wertemengen kommen nur so vor die Linse;
    // vorher fielen sie durch, weder geprueft noch als unlesbar gezaehlt.
    const datei = widgetSources[kind];
    if (datei) {
      let quelle: string | null = null;
      try { quelle = readSource(`${HOMEPAGE_WIDGET_DIR}/${datei}.tsx`); } catch { quelle = null; }
      if (quelle) {
        const gefunden = documentedValuesNotInSource(
          ((eintrag as Record<string, unknown>).config ?? []) as Array<{ name: string; values?: string[] }>,
          quelle,
          werteZaehler,
        );
        if (gefunden.length > 0) werteNichtImCode[kind] = gefunden;
      }
    }

    const werte = werteNichtImCode[kind];
    if (werte && werte.length > 0) {
      (eintrag as Record<string, unknown>).config_values_not_in_widget = werte;
    } else {
      delete (eintrag as Record<string, unknown>).config_values_not_in_widget;
    }
  }

  const navigationGroupContract = {
    type: "string|null",
    max_length: 100,
    scope: "PublicClubApp Standalone-Fallback und dessen HomePreviewPage; Fixed Templates und PublicClubHubView bleiben flach.",
    purpose: "Tabs mit demselben getrimmten Wert werden in der öffentlichen Navigation unter diesem Menüpunkt zusammengefasst.",
    behavior: "Der Gruppen-Klick öffnet ein Menü; der Klick auf einen Eintrag navigiert weiter zur unveränderten Tab-URL.",
    normalization: "Nur Leerzeichen wird null; Gruppennamen werden ohne Beachtung der Groß-/Kleinschreibung verglichen; angezeigt wird die erste Schreibweise.",
    example: { navigation_group: "Sport", child_slugs: ["fussball", "dart"] },
  };

  return {
    ...existing,
    domain: "homepage",
    generated: true,
    source: [slash(HOMEPAGE_REGISTRY), slash(HOMEPAGE_PROMPT), slash(HOMEPAGE_SECTION_SCHEMA), slash(HOMEPAGE_WIDGET_KINDS)],
    widget_count: kinds.length,
    widget_config_documented: documented,
    vocabulary_sync: {
      registry_count: kinds.length,
      backend_count: backendKinds.length,
      prompt_count: promptKinds.length,
      missing_in_backend: kinds.filter((kind) => !backendKinds.includes(kind)),
      missing_in_prompt: kinds.filter((kind) => !promptKinds.includes(kind)),
      extra_in_backend: backendKinds.filter((kind) => !kinds.includes(kind)),
      extra_in_prompt: promptKinds.filter((kind) => !kinds.includes(kind)),
    },
    config_sync: {
      widgets_checked: widgetsGeprueft,
      fields_checked: felderGeprueft,
      widgets_with_unread_fields: Object.keys(nichtImCode).length,
      unread_fields: Object.values(nichtImCode).reduce((n, f) => n + f.length, 0),
      widgets_with_wrong_values: Object.keys(werteNichtImCode).length,
      wrong_values: Object.values(werteNichtImCode)
        .reduce((n, fs) => n + fs.reduce((m, f) => m + f.unknown.length, 0), 0),
      value_sets_checked: werteZaehler.gelesen,
      value_sets_unreadable: werteZaehler.nichtLesbar,
      note:
        "Ein Feld unter config_not_read_by_widget kommt im Quelltext des Widgets nicht vor. " +
        "Wer es setzt, konfiguriert ins Leere: Das Backend nimmt unbekannte Config-Schluessel " +
        "an, und niemand meldet etwas. Das ist ein HINWEIS, kein Urteil — geprueft wird ein " +
        "Wortvorkommen, kein Auslesen. Die Pruefung schweigt also eher, als dass sie falsch " +
        "anschlaegt; ein Treffer lohnt trotzdem den Blick in das Widget. " +
        "config_values_not_in_widget ist die zweite Haelfte: Der Feldname kann stimmen und die " +
        "Wertemenge trotzdem erfunden sein — `stats` dokumentierte layout: card|bold|minimal, " +
        "das Widget kennt grid|horizontal|bento. Gelesen wird die Wertemenge aus einer " +
        "Inline-Union oder einem Typalias; ist sie so nicht auffindbar, gibt es keinen Befund — " +
        "value_sets_unreadable zaehlt genau diese Faelle, damit die Null nicht wie eine " +
        "Entwarnung fuer alle liest. Am 2026-08-28 waren es 15 von 76, alle von Hand geprueft " +
        "und korrekt; ein dritter Leseweg ueber Rumpf-Vergleiche wurde gemessen und verworfen, " +
        "weil er bei drei gelesenen Feldern zwei Fehlalarme erzeugte (ein Wert im else-Zweig " +
        "und ein abgeleiteter Bezeichner).",
    },
    note:
      "widget_kinds = autoritative WIDGET_REGISTRY-Keys (index.ts). config-Felder je Widget " +
      "stammen aus dem homepage_system.py-Prompt — nicht jeder kind hat dort einen Eintrag " +
      "(Phase-4-Widgets fehlen); diese erscheinen mit config: [] (ehrlich, kein erfundenes Schema). " +
      "Der Prompt ist gegenueber dem Widget-Code stellenweise veraltet; wo das auffaellt, steht " +
      "es je Widget unter config_not_read_by_widget und gezaehlt unter config_sync.",
    structure: {
      ...(existing.structure ?? {}),
      tab: {
        ...(existing.structure?.tab ?? {}),
        fields: ["label", "slug", "icon", "navigation_group", "position", "visibility_scope", "department_id", "sections"],
        visibility_scope_enum: ["public", "member", "department"],
        navigation_group_contract: navigationGroupContract,
      },
      section: {
        ...(existing.structure?.section ?? {}),
        fields: ["layout", "style_variant", "sort_order", "title", "is_visible", "bg_image_url", "widgets"],
        layout_enum: layout,
        style_variant_enum: style_variant,
      },
      widget: {
        ...(existing.structure?.widget ?? {}),
        fields: ["kind", "title", "config", "slot_index", "preset"],
        preset_enum: ["", "glass", "dark", "gradient", "soft", "elevated", "outlined", "neon"],
      },
    },
    preview_contract: existing.preview_contract ?? {
      no_live_write: true,
      design_snapshot_version: 1,
      optional_top_level_fields: ["design_snapshot_version", "design_settings"],
      cli: "comvenio homepage preview --file home.json --design-file design_settings.json",
      legacy_without_design_snapshot: "readable_until_ttl_with_live_design_warning",
    },
    templates: ["elegance", "sport", "community", "minimal", "festlich", "modern", "classic", "flex"],
    widget_kinds: kinds,
    widgets: mergedWidgets,
  };
}

// ─── Domain: menu ────────────────────────────────────────────────────────────

const MENU_PREVIEW = "Frontend/web-page/src/components/supply-service/MenuPreview.tsx";
const SUPPLY_CORE = "Backend/Microservice-Backend/supply-service/app/models/core.py";

/**
 * Collect simple literal-union type aliases from a TS source:
 *   `export type MenuTemplate = "classic" | "modern";`
 *   `type TextAlign = "left" | "center" | "right";`
 * Returns alias name -> the raw union string (`"classic" | "modern"`), so a
 * field typed by the alias can be expanded to its enum values.
 */
function parseLiteralUnionAliases(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(?:export\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const def = m[2].trim();
    // Only keep aliases that are pure literal unions (string/number literals).
    if (/^(["'][^"']*["']|\d+)(\s*\|\s*(["'][^"']*["']|\d+))*$/.test(def)) {
      out[name] = def;
    }
  }
  return out;
}

/**
 * Parse the exported `type MenuDesignOptions = { ... }` body into fields.
 * Each field: `name: TsType;` (optional `name?:`). Literal unions and aliases
 * that resolve to literal unions are surfaced as enum value lists.
 */
function parseMenuDesignOptions(
  previewSrc: string,
): Record<string, { type: string; optional?: boolean; values?: Array<string | number> }> {
  const start = previewSrc.indexOf("export type MenuDesignOptions");
  if (start === -1) throw new Error("MenuDesignOptions-Typ nicht in MenuPreview.tsx gefunden.");
  const braceStart = previewSrc.indexOf("{", start);
  // Find the matching closing brace of the type literal.
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < previewSrc.length; i++) {
    const ch = previewSrc[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("MenuDesignOptions-Body nicht abschliessbar (Klammern).");
  const body = previewSrc.slice(braceStart + 1, end);

  // Resolve simple literal-union type aliases (`export type X = "a" | "b";`) so
  // fields typed `X` surface their actual enum values, not just the alias name.
  const aliases = parseLiteralUnionAliases(previewSrc);

  const out: Record<
    string,
    { type: string; optional?: boolean; values?: Array<string | number> }
  > = {};

  // Strip `// ...` line comments to avoid false field matches.
  const lines = body.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "").trim());

  const asUnionValues = (ts: string): Array<string | number> | undefined => {
    if (/^(["'][^"']+["']|\d+)(\s*\|\s*(["'][^"']+["']|\d+))+$/.test(ts)) {
      return ts.split("|").map((v) => {
        const t = v.trim().replace(/^["']|["']$/g, "");
        return /^\d+$/.test(t) ? Number(t) : t;
      });
    }
    return undefined;
  };

  for (const line of lines) {
    if (!line || line.startsWith("/*") || line.startsWith("*")) continue;
    // `name: Type;`  or  `name?: Type;`
    const fieldM = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\??)\s*:\s*(.+?);?$/.exec(line);
    if (!fieldM) continue;
    const name = fieldM[1];
    const optional = fieldM[2] === "?";
    let tsType = fieldM[3].trim().replace(/;$/, "");

    // Resolve a bare alias reference to its underlying union/type.
    if (aliases[tsType]) tsType = aliases[tsType];

    // Literal string/number union → enum values.
    const values = asUnionValues(tsType);

    // Normalise the reported "type".
    let type: string;
    if (values) type = "enum";
    else if (/^(string)$/.test(tsType)) type = "string";
    else if (/^(number)$/.test(tsType)) type = "number";
    else if (/^(boolean)$/.test(tsType)) type = "bool";
    else if (/\[\]$/.test(tsType) || /^Array</.test(tsType)) type = "array";
    else type = tsType; // keep complex types verbatim (e.g. OverlayItem[])

    out[name] = { type, ...(optional ? { optional: true } : {}), ...(values ? { values } : {}) };
  }

  if (Object.keys(out).length === 0)
    throw new Error("Keine Felder aus MenuDesignOptions geparst.");
  return out;
}

function genMenu(): unknown {
  const previewSrc = readSource(MENU_PREVIEW);
  const coreSrc = readSource(SUPPLY_CORE);

  const design = parseMenuDesignOptions(previewSrc);
  const unitType = parsePyEnum(coreSrc, "UnitType"); // 10 values (authoritative)
  const typeOfRecipe = parsePyEnum(coreSrc, "TypeOfIngredient"); // food/drink

  return {
    domain: "menu",
    generated: true,
    source: [slash(MENU_PREVIEW), slash(SUPPLY_CORE)],
    note:
      "design_config_fields = exportierter MenuDesignOptions-Typ (MenuPreview.tsx). " +
      "unit_type/type_of_recipe AUTORITATIV aus supply-service core.py (UnitType hat 10 Werte, " +
      "NICHT die 6 des veralteten Frontend-Types).",
    design_config_fields: design,
    menu_item_fields: {
      name: { type: "string", required: true },
      selling_price: { type: "number", optional: true },
      display_order: { type: "int" },
      recipe_id: {
        type: "string",
        optional: true,
        note: "nullable — reine Anzeige-Karte ohne Rezept moeglich",
      },
    },
    unit_type: unitType,
    type_of_recipe: typeOfRecipe,
  };
}

// ─── Domain: event ───────────────────────────────────────────────────────────

const EVENT_MODEL = "Backend/Microservice-Backend/event-service/app/models/event.py";
const EVENT_SERIES_MODEL = "Backend/Microservice-Backend/event-service/app/models/event_series.py";
const EVENT_INVITATION_SCHEMA = "Backend/Microservice-Backend/event-service/app/schemas/event_invitation.py";
const EVENT_CLUB_INVITATION_SCHEMA = "Backend/Microservice-Backend/event-service/app/schemas/club_event_invitation.py";
const EVENT_RESOURCE_SCHEMA = "Backend/Microservice-Backend/event-service/app/schemas/event_resource_link.py";
const EVENT_CONTACT_SCHEMA = "Backend/Microservice-Backend/event-service/app/schemas/event_contact.py";
const EVENT_DESIGN_MODEL = "Backend/Microservice-Backend/event-service/app/models/event_design.py";
const EVENT_EXTERNAL_SYNC_SCHEMA = "Backend/Microservice-Backend/event-service/app/schemas/external_team_sync.py";

function genEvent(): unknown {
  const src = readSource(EVENT_MODEL);
  const seriesSrc = readSource(EVENT_SERIES_MODEL);
  const invitationSrc = readSource(EVENT_INVITATION_SCHEMA);
  const clubInvitationSrc = readSource(EVENT_CLUB_INVITATION_SCHEMA);
  const resourceSrc = readSource(EVENT_RESOURCE_SCHEMA);
  const contactSrc = readSource(EVENT_CONTACT_SCHEMA);
  const designSrc = readSource(EVENT_DESIGN_MODEL);
  const externalSyncSrc = readSource(EVENT_EXTERNAL_SYNC_SCHEMA);
  return {
    domain: "event",
    generated: true,
    source: [
      slash(EVENT_MODEL),
      slash(EVENT_SERIES_MODEL),
      slash(EVENT_INVITATION_SCHEMA),
      slash(EVENT_CLUB_INVITATION_SCHEMA),
      slash(EVENT_RESOURCE_SCHEMA),
      slash(EVENT_CONTACT_SCHEMA),
      slash(EVENT_DESIGN_MODEL),
      slash(EVENT_EXTERNAL_SYNC_SCHEMA),
    ],
    note: "Event-/Serien-Enums aus den Models; Subresource-Enums aus den API-Schemas. Vollständige Agent-Anleitung: docs/veranstaltungen.md.",
    enums: {
      event_type: parsePyEnum(src, "EventType"),
      visibility_scope: parsePyEnum(src, "VisibilityScope"),
      organizer_type: parsePyEnum(src, "OrganizerType"),
      status: parsePyEnum(src, "EventStatus"),
      complexity: parsePyEnum(src, "EventComplexity"),
      series_type: parsePyEnum(seriesSrc, "SeriesType"),
      materialization_mode: parsePyEnum(seriesSrc, "MaterializationMode"),
      invitation_status: parsePyEnum(invitationSrc, "InvitationStatus"),
      club_invitation_type: parsePyEnum(clubInvitationSrc, "ClubInvitationType"),
      club_invitation_status: parsePyEnum(clubInvitationSrc, "ClubInvitationStatus"),
      resource_target: parsePyEnum(resourceSrc, "ReservationTarget"),
      contact_priority: parsePyEnum(contactSrc, "EventContactPriority"),
      contact_visibility: parsePyEnum(contactSrc, "EventContactVisibility"),
      design_asset_type: parsePyEnum(designSrc, "DesignAssetType"),
      design_asset_source: parsePyEnum(designSrc, "DesignAssetSource"),
      external_sync_provider: parsePyEnum(externalSyncSrc, "ExternalSyncProvider"),
      recurrence_frequency: ["daily", "weekly", "monthly", "yearly"],
      recurrence_weekday: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
    },
    create_required_fields: [
      "title",
      "event_type",
      "visibility_scope",
      "organizer_type",
      "club_id",
      "department_id",
    ],
    create_optional_fields: [
      "start_time",
      "end_time",
      "description",
      "location",
      "status",
      "organizer_member_id",
      "event_complexity",
      "is_template",
    ],
    templates: {
      commands: ["list", "create", "clone", "instantiate"],
      create: "event template create nutzt EventCreate mit is_template=true",
      instantiate_required_fields: ["start_time", "end_time"],
      instantiate_copy_defaults: {
        copy_tags: true,
        copy_areas: true,
        copy_tasks: true,
        copy_task_assignments: false,
      },
    },
    series: {
      commands: [
        "list",
        "show",
        "create",
        "update",
        "delete",
        "materialize",
        "next",
        "promote-recurring",
        "promote-yearly",
      ],
      create_required_fields: ["template_event_id", "dtstart"],
      defaults: {
        recurring: { frequency: "weekly", materialization_mode: "AUTO" },
        yearly: { frequency: "yearly", materialization_mode: "MANUAL" },
        timezone: "Europe/Berlin",
        duration_minutes: 120,
      },
      friendly_flags: [
        "frequency",
        "interval",
        "weekdays",
        "by_month",
        "by_month_day",
        "until",
        "count",
      ],
      materialize_required_fields: ["window_start", "window_end"],
    },
    command_groups: {
      core: ["list", "show", "create", "update", "publish", "delete"],
      template: ["list", "create", "clone", "instantiate"],
      series: ["list", "show", "create", "update", "delete", "materialize", "next", "promote-recurring", "promote-yearly"],
      instance: ["previous", "next", "compare", "clone-next"],
      child: ["list", "create", "invitation-summary"],
      area: ["list", "show", "add", "update", "delete", "bulk", "copy"],
      assignment: ["list", "add", "remove", "clear"],
      lead: ["list", "add", "update", "delete"],
      area_note: ["list", "add", "update", "delete"],
      program: ["list", "add", "update", "delete", "reorder"],
      contact: ["list", "add", "update", "delete"],
      resource: ["list", "add", "set", "remove", "link-show", "link-update", "link-delete", "usage", "usage-batch"],
      attachment: ["list", "show", "add", "update", "delete"],
      tag: ["category-list", "category-show", "category-add", "category-update", "category-delete", "list", "show", "add", "update", "delete", "assigned", "assignment-list", "assign", "unassign", "clear"],
      sponsor: ["list", "add", "delete", "tier-list", "tier-add", "tier-update", "tier-delete", "tier-sync"],
      sponsor_program: ["list", "by-program", "add", "delete"],
      invitation: ["mine", "list", "show", "add", "groups", "departments", "org-groups", "update", "status", "delete", "notified"],
      club_invitation: ["list", "attending", "incoming", "accepted", "show", "add", "external", "self-join", "update", "respond", "delete"],
      registration: ["list", "add", "stats", "show", "update", "adjust", "delete", "aggregate"],
      budget: ["show", "set", "delete"],
      design: ["theme-show", "theme-set", "theme-delete", "asset-list", "asset-upload", "asset-delete"],
      copy: ["set", "reset"],
      dj: ["settings", "requests", "settings-set", "request-status", "reset"],
      external_sync: ["list", "add", "show", "update", "delete", "matches", "run", "stats", "provider-run"],
      menu: ["list", "assign", "unassign"],
    },
    file_payloads: {
      convention: "Komplexe Bodies werden mit --file <payload.json> übergeben. IDs im Pfad kommen aus dem Command; club_id wird dort injiziert, wo der Vertrag eindeutig ist.",
      area_create: { required: ["name"], optional: ["description", "color", "is_public", "public_description", "area_category", "opens_at", "closes_at", "geometry", "crs_mode", "is_default"] },
      area_bulk: { required: ["event_id", "areas"], areas_fields: ["name", "description", "color", "is_public", "public_description", "area_category", "opens_at", "closes_at"] },
      area_copy: { required: ["source_area_ids", "target_event_ids"], optional: ["copy_leads", "copy_assignments", "copy_notes", "copy_program", "copy_contacts", "copy_sponsors", "copy_resources", "copy_tasks", "copy_shifts", "reuse_existing"] },
      program: { create_fields: ["club_id", "area_id", "title", "start_time", "end_time", "time_label", "description", "responsible_member_id", "image_file_id", "flyer_file_id", "reference_type", "reference_id", "reference_label", "reference_url", "sort_order"] },
      resource_bulk: { body: { targets: [{ target_type: "object|room|building", target_id: "uuid", event_area_id: "uuid|null" }] } },
      tag_updates: { behavior: "Die CLI lädt den bestehenden Datensatz und ergänzt die vom Backend verlangten Pflichtfelder club_id bzw. category_id." },
      contact: { priority: ["normal", "important", "emergency"], visibility: ["public", "members", "admin"] },
      registration: { create_fields: ["attendee_count", "contact_name", "contact_email", "contact_phone", "notes", "orders"], order_fields: ["menu_item_id", "quantity", "note"] },
      design_theme: { fields: ["name", "base_brief", "css_vars", "reference_image_ids", "mood_tags"] },
      external_sync: { create_fields: ["department_id", "provider", "external_club_id", "external_team_id", "age_group_filter", "home_location", "team_label", "sync_enabled"] },
    },
    cross_domain_commands: {
      map: "comvenio plan ...",
      files: "comvenio data ...; danach event attachment add zum fachlichen Verknüpfen",
      sponsor_master_data: "comvenio sponsor ...; danach event sponsor add",
      tasks_and_shifts: "comvenio task ... auf dem EventArea-Task-Kontext",
      event_menu: "comvenio event menu ...",
      bookings: "comvenio booking/object ...; event resource verwaltet nur den Event-Link",
    },
    intentionally_not_exposed: {
      internal: "Alle /internal-Routen und System-Copy-Mutationen benötigen internen API-Key und gehören nicht ins Club-CLI.",
      public_forms: "Öffentliche Share-/Token-Formular-Routen werden nicht als Club-Verwaltung gespiegelt.",
      calendar_subscriptions: "Der Router dekodiert derzeit Standard-JWT direkt und akzeptiert den opaken cvn_-Tokenvertrag noch nicht zuverlässig.",
      legacy_map: "Legacy GET /events/{id}/map und PUT /map-plan; V2+ liegt vollständig unter comvenio plan.",
    },
    notes: [
      "Es gibt KEINEN 'published'-Status — publish = PATCH status=confirmed.",
      "list/show haben keinen RBAC-Key (nur Visibility-Filter).",
      "multi_day-Events muessen visibility_scope=public behalten.",
      "EventArea anlegen via POST /events/areas/ mit event_id + club_id + name.",
      "Wiederkehrende Events: zuerst Vorlage, dann Serie, danach ein Zeitfenster idempotent materialisieren.",
    ],
  };
}

// ─── Domain: task ────────────────────────────────────────────────────────────

const TASK_MODEL = "Backend/Microservice-Backend/task-service/app/models/task.py";
const TASK_REMINDER_ROUTES = "Backend/Microservice-Backend/automation-service/app/routes/notifications.py";

function genTask(): unknown {
  const src = readSource(TASK_MODEL);
  const reminderRoutes = readSource(TASK_REMINDER_ROUTES);
  if (!reminderRoutes.includes('"/custom_reminders/task"')
    || !reminderRoutes.includes('"/custom_reminders/task/by-task/{task_id}"')) {
    throw new Error("Persönlicher Task-Reminder-Vertrag fehlt in automation-service.");
  }
  return {
    domain: "task",
    generated: true,
    source: [slash(TASK_MODEL), slash(TASK_REMINDER_ROUTES)],
    note:
      "status/priority/phase aus den task-service Enum-Klassen (task.py). " +
      "context_type ist im task-service ein eigener TaskContextType-Enum (club/event/object/meeting/supply) — " +
      "hier statisch, da kein zentraler Enum in task.py.",
    enums: {
      status: parsePyEnum(src, "TaskStatus"),
      priority: parsePyEnum(src, "TaskPriority"),
      phase: parsePyEnum(src, "TaskPhase"),
      context_type: ["club", "event", "object", "meeting", "supply"],
    },
    commands: {
      task: ["list", "show", "create", "bulk", "update", "assign", "done", "delete"],
      reminder: ["set", "list", "delete"],
      context: ["list", "show", "create", "update", "delete"],
      assignment: ["list", "show", "update", "delete"],
      note: ["list", "add", "update", "delete"],
      checklist: ["list", "add", "update", "toggle", "delete", "reorder"],
    },
    create_required_fields: ["title", "club_id", "task_context_id"],
    assignment_required_fields: ["task_id", "member_id", "club_id"],
    bulk_contract: {
      root: "items",
      item_fields: ["task", "checklist_items", "assignments"],
    },
    notes: [
      "task create braucht zwingend task_context_id (kein 'Default-Context'-Lookup) — via task context list/create.",
      "task assign erwartet member_id, NICHT user_id.",
      "task done = PUT /tasks/{id} status=completed + completed_at (CLI setzt completed_at selbst).",
      "task reminder ist ausschließlich subject-gebunden und akzeptiert keine Empfänger-, Club- oder Abteilungs-ID.",
      "completed/cancelled koennen NICHT zurueck auf open gesetzt werden (Backend-Guard).",
    ],
  };
}

// ─── Domain: booking ─────────────────────────────────────────────────────────

const OBJECT_ENUMS = "Backend/Microservice-Backend/object-service/app/enums.py";
const OBJECT_RESERVATION_SCHEMA = "Backend/Microservice-Backend/object-service/app/schemas/Object/ObjectReservation.py";

function genBooking(): unknown {
  const src = readSource(OBJECT_ENUMS);
  return {
    domain: "booking",
    generated: true,
    source: [slash(OBJECT_ENUMS), slash(OBJECT_RESERVATION_SCHEMA)],
    note: "Reservierungs-, Teilnehmer- und Bulk-Vertraege aus dem object-service.",
    enums: {
      reservation_status: parsePyEnum(src, "ReservationStatus"),
      participant_status: parsePyEnum(src, "ParticipantStatus"),
      object_type: parsePyEnum(src, "ObjectType"),
      booking_granularity: parsePyEnum(src, "BookingGranularity"),
    },
    commands: {
      reservation: ["list", "show", "create", "update", "approve", "reject", "cancel", "delete", "bulk"],
      participant: ["list", "show", "add", "add-groups", "update", "remove"],
      link: ["list", "club", "add", "remove"],
      stats: ["object", "guests"],
    },
    create_required_fields: ["object_id", "club_id", "start_time", "end_time"],
    create_optional_fields: ["title", "comment", "status", "participants", "resp_member_id"],
    bulk_fields: [
      "object_id", "club_id", "start_time", "end_time", "title", "comment", "status",
      "resp_member_id", "participants", "group_ids", "portable_reservations",
    ],
    update_required_fields: ["club_id", "object_id"],
    participant_create_fields: [
      "club_id", "object_reservation_id", "member_id", "status", "is_guest", "guest_name", "guest_email",
    ],
    participant_update_required_fields: ["id", "club_id", "status"],
    reservation_link_required_fields: ["primary_reservation_id", "linked_reservation_id"],
    stats_filters: {
      object: ["year", "month"],
      guests: ["from_date", "to_date"],
    },
    notes: [
      "approve/reject/cancel sind PATCH-Statuswechsel, keine eigenen Backend-Endpunkte.",
      "Die CLI laedt vor PATCH die Reservierung und ergaenzt club_id + object_id.",
      "Kein status-Query-Filter; --pending filtert clientseitig auf status=requested.",
      "Owner-Bypass-Sperre: eigene Buchung kann nicht selbst genehmigt werden (403).",
      "Teilnehmer-Update verwendet PUT /object-reservations/participants/{id}.",
      "ReservationLinks benoetigen club_id als Query-Parameter.",
      "Interne Endpunkte und der anonyme Public-Highlight-Endpunkt sind nicht Teil der Admin-CLI.",
    ],
  };
}

// ─── Domain: member ──────────────────────────────────────────────────────────

const MEMBER_TEAM_MODEL = "Backend/Microservice-Backend/member-service/app/models/team.py";

function genMember(): unknown {
  const src = readSource(MEMBER_TEAM_MODEL);
  return {
    domain: "member",
    generated: true,
    source: [slash(MEMBER_TEAM_MODEL)],
    note:
      "TeamMemberRole aus member-service team.py. Es gibt KEINEN zentralen Member-Status-Enum " +
      "(MembershipStatus ist club-spezifisch/dynamisch) — daher nur Kernfelder + strukturelle Enums.",
    create_required_fields: ["club_id", "first_name", "last_name"],
    create_optional_fields: [
      "email",
      "phone_number",
      "birthdate",
      "address",
      "postal_code",
      "city",
      "state",
      "country",
      "joined_at",
      "user_id",
      "membership_status_id",
      "family_id",
    ],
    update_fields: {
      note: "Alle Felder optional. club_id ist NICHT im MemberUpdate-Schema (Club nicht aenderbar).",
    },
    enums: {
      team_member_role: parsePyEnum(src, "TeamMemberRole"),
    },
    commands: {
      member: ["list", "show", "add", "update", "remove", "import"],
      family: ["list", "show", "add", "update", "delete"],
      membership_status: ["list", "show", "add", "update", "delete"],
      membership_period: ["list", "show", "add", "update", "delete"],
    },
    family_create_required_fields: ["club_id", "name", "responsible_member_id"],
    membership_status_create_required_fields: ["club_id", "name"],
    membership_period_create_required_fields: ["member_id", "club_id", "joined_at"],
    bulk_import_fields: [
      "club_id", "rows", "preview", "import_date", "reconcile_absent_members", "present_member_ids",
    ],
    notes: [
      "member ohne user_id ist normal (null-Feld).",
      "RBAC-Rollen laufen ueber den role-service, NICHT member-service — kein member role-Command.",
      "team member --role ist TeamMemberRole (PLAYER/COACH/...), KEINE Berechtigungsrolle.",
    ],
  };
}

// ─── Driver ──────────────────────────────────────────────────────────────────

const GENERATORS: Record<string, () => unknown> = {
  homepage: genHomepage,
  menu: genMenu,
  event: genEvent,
  task: genTask,
  booking: genBooking,
  member: genMember,
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function main(): number {
  let drift = false;

  for (const [domain, gen] of Object.entries(GENERATORS)) {
    let generated: string;
    try {
      generated = stableJson(gen());
    } catch (err) {
      console.error(`[${domain}] Generierung fehlgeschlagen: ${(err as Error).message}`);
      return 1;
    }

    const outPath = join(SCHEMA_DIR, `${domain}.json`);

    if (CHECK_MODE) {
      const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
      const normalizedCurrent = current.replace(/\r\n/g, "\n");
      if (normalizedCurrent !== generated) {
        drift = true;
        console.error(
          `DRIFT in src/schema/${domain}.json — committete Datei != aus Quelle generiert.`,
        );
        console.error(diffSummary(normalizedCurrent, generated));
      } else {
        console.log(`OK   src/schema/${domain}.json (kein Drift)`);
      }
    } else {
      const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
      const output = current.includes("\r\n") ? generated.replace(/\n/g, "\r\n") : generated;
      writeFileSync(outPath, output, "utf8");
      console.log(`schrieb ${slash(relative(CLI_ROOT, outPath))}`);
    }
  }

  if (CHECK_MODE && drift) {
    console.error(
      "\nDrift gefunden. Quelle wurde geaendert ohne `bun run gen:schema` auszufuehren.\n" +
        "Fix: `bun run gen:schema` lokal laufen + die geaenderten src/schema/*.json committen.",
    );
    return 1;
  }
  if (CHECK_MODE) {
    console.log("\nKein Drift — alle Schema-Dateien stimmen mit den Quellen ueberein.");
  }
  return 0;
}

/** Compact line-level diff summary for --check output (no external dep). */
function diffSummary(current: string, generated: string): string {
  const a = current.split("\n");
  const b = generated.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: string[] = [];
  let shown = 0;
  for (let i = 0; i < max && shown < 20; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) lines.push(`  - ${a[i]}`);
      if (b[i] !== undefined) lines.push(`  + ${b[i]}`);
      shown++;
    }
  }
  if (shown >= 20) lines.push("  … (weitere Unterschiede)");
  return lines.join("\n");
}

process.exit(main());
