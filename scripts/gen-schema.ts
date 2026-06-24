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
  const abs = join(WORKSPACE, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `Quelle nicht gefunden: ${relPath}\n` +
        `  erwartet unter: ${abs}\n` +
        `  Workspace-Root: ${WORKSPACE}\n` +
        `  Setze COMVENIO_WORKSPACE falls der Workspace woanders liegt.`,
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
const HOMEPAGE_SECTION_MODEL =
  "Backend/Microservice-Backend/club-service/app/models/club_home_section.py";

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
  // The values are documented as inline comments (`"full"  → ...`). Collect the
  // quoted keys following `layout`/`style_variant` column docs.
  const grabAfter = (anchor: string): string[] => {
    const idx = sectionSrc.indexOf(anchor);
    if (idx === -1) return [];
    // Look back a bit and forward to the Column assignment to scope the comment block.
    const windowStart = sectionSrc.lastIndexOf("#", idx); // not robust enough alone
    void windowStart;
    return [];
  };
  void grabAfter;

  // Simpler + robust: pull the documented value sets directly. These live as
  // `# "full" → ...` comment lines grouped above each Column. We scan the lines
  // between the `layout = Column` doc block and `style_variant = Column` doc block.
  const layout = extractQuotedDocValues(sectionSrc, "layout = Column");
  const style_variant = extractQuotedDocValues(sectionSrc, "style_variant = Column");
  return { layout, style_variant };
}

/**
 * Collect quoted values from the comment block immediately preceding a Column
 * assignment, e.g. lines like `# "full" → 1 Widget`. Falls back to empty if
 * the comment style changes (caller supplies a default then).
 */
function extractQuotedDocValues(src: string, columnAnchor: string): string[] {
  const colIdx = src.indexOf(columnAnchor);
  if (colIdx === -1) return [];
  // The doc-comment block is the contiguous run of `#` lines just above the anchor.
  const before = src.slice(0, colIdx);
  const lines = before.split(/\r?\n/);
  const block: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith("#")) {
      block.unshift(t);
    } else if (t === "") {
      // skip blank gap but stop if we already collected something
      if (block.length > 0) break;
    } else {
      break;
    }
  }
  const values: string[] = [];
  const q = /["']([a-z][a-z0-9_-]*)["']/g;
  for (const l of block) {
    let m: RegExpExecArray | null;
    while ((m = q.exec(l)) !== null) values.push(m[1]);
  }
  return values;
}

function genHomepage(): unknown {
  const registrySrc = readSource(HOMEPAGE_REGISTRY);
  const promptSrc = readSource(HOMEPAGE_PROMPT);
  const sectionSrc = readSource(HOMEPAGE_SECTION_MODEL);

  const kinds = parseWidgetKinds(registrySrc);
  const promptConfigs = parsePromptConfigs(promptSrc);
  const sectionEnums = parseSectionEnums(sectionSrc);

  // Fall back to the documented value sets if comment-parsing yields nothing.
  const layout =
    sectionEnums.layout.length > 0
      ? sectionEnums.layout
      : ["full", "two-col", "three-col", "sidebar-left", "sidebar-right"];
  const style_variant =
    sectionEnums.style_variant.length > 0
      ? sectionEnums.style_variant
      : ["default", "primary", "dark", "subtle", "gradient"];

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

  return {
    domain: "homepage",
    generated: true,
    source: [slash(HOMEPAGE_REGISTRY), slash(HOMEPAGE_PROMPT), slash(HOMEPAGE_SECTION_MODEL)],
    widget_count: kinds.length,
    widget_config_documented: documented,
    note:
      "widget_kinds = autoritative WIDGET_REGISTRY-Keys (index.ts). config-Felder je Widget " +
      "stammen aus dem homepage_system.py-Prompt — nicht jeder kind hat dort einen Eintrag " +
      "(Phase-4-Widgets fehlen); diese erscheinen mit config: [] (ehrlich, kein erfundenes Schema).",
    structure: {
      tab: {
        fields: ["label", "slug", "icon", "position", "visibility_scope", "department_id", "sections"],
        visibility_scope_enum: ["public", "member", "department"],
      },
      section: {
        fields: ["layout", "style_variant", "sort_order", "title", "is_visible", "bg_image_url", "widgets"],
        layout_enum: layout,
        style_variant_enum: style_variant,
      },
      widget: {
        fields: ["kind", "title", "config", "slot_index", "preset"],
        preset_enum: ["", "glass", "dark", "gradient", "soft", "elevated", "outlined", "neon"],
      },
    },
    templates: ["elegance", "sport", "community", "minimal", "festlich", "modern", "classic"],
    widget_kinds: kinds,
    widgets,
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

function genEvent(): unknown {
  const src = readSource(EVENT_MODEL);
  return {
    domain: "event",
    generated: true,
    source: [slash(EVENT_MODEL)],
    note: "Enums direkt aus den event-service SQLAlchemy-Enum-Klassen (event.py).",
    enums: {
      event_type: parsePyEnum(src, "EventType"),
      visibility_scope: parsePyEnum(src, "VisibilityScope"),
      organizer_type: parsePyEnum(src, "OrganizerType"),
      status: parsePyEnum(src, "EventStatus"),
      complexity: parsePyEnum(src, "EventComplexity"),
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
      "complexity",
    ],
    notes: [
      "Es gibt KEINEN 'published'-Status — publish = PATCH status=confirmed.",
      "list/show haben keinen RBAC-Key (nur Visibility-Filter).",
      "multi_day-Events muessen visibility_scope=public behalten.",
      "EventArea anlegen via POST /events/areas/ mit event_id + club_id + name.",
    ],
  };
}

// ─── Domain: task ────────────────────────────────────────────────────────────

const TASK_MODEL = "Backend/Microservice-Backend/task-service/app/models/task.py";

function genTask(): unknown {
  const src = readSource(TASK_MODEL);
  return {
    domain: "task",
    generated: true,
    source: [slash(TASK_MODEL)],
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
    create_required_fields: ["title", "club_id", "task_context_id"],
    assignment_required_fields: ["task_id", "member_id", "club_id"],
    notes: [
      "task create braucht zwingend task_context_id (kein 'Default-Context'-Lookup) — via task context list/create.",
      "task assign erwartet member_id, NICHT user_id.",
      "task done = PUT /tasks/{id} status=completed + completed_at (CLI setzt completed_at selbst).",
      "completed/cancelled koennen NICHT zurueck auf open gesetzt werden (Backend-Guard).",
    ],
  };
}

// ─── Domain: booking ─────────────────────────────────────────────────────────

const OBJECT_ENUMS = "Backend/Microservice-Backend/object-service/app/enums.py";

function genBooking(): unknown {
  const src = readSource(OBJECT_ENUMS);
  return {
    domain: "booking",
    generated: true,
    source: [slash(OBJECT_ENUMS)],
    note: "reservation_status/object_type aus den object-service Enum-Klassen (enums.py).",
    enums: {
      reservation_status: parsePyEnum(src, "ReservationStatus"),
      object_type: parsePyEnum(src, "ObjectType"),
    },
    update_required_fields: ["club_id", "object_id"],
    notes: [
      "approve = PATCH status=approved, reject = PATCH status=rejected.",
      "PATCH-Body braucht club_id + object_id (Pflicht) — vorher GET der Reservierung.",
      "Kein status-Query-Filter; --pending filtert clientseitig auf status=requested.",
      "object list --type ist ein Sub-Pfad (/objects/club/{id}/{type}), kein Query-Param.",
      "Owner-Bypass-Sperre: eigene Buchung kann nicht selbst genehmigt werden (403).",
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
      if (current !== generated) {
        drift = true;
        console.error(
          `DRIFT in src/schema/${domain}.json — committete Datei != aus Quelle generiert.`,
        );
        console.error(diffSummary(current, generated));
      } else {
        console.log(`OK   src/schema/${domain}.json (kein Drift)`);
      }
    } else {
      writeFileSync(outPath, generated, "utf8");
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
