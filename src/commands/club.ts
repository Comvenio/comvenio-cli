import type { CAC } from "cac";
import { AuthError, loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output } from "../format.ts";
import { readJsonFile } from "../util/file.ts";
import { readFileSync } from "node:fs";

type ClubResponse = {
  id?: string;
  name?: string;
  short_name?: string;
  email_address?: string;
  phone_number?: string;
  website_url?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  founded_date?: string;
  [key: string]: unknown;
};

export type Opts = {
  json?: boolean;
  club?: string;
  search?: string;
  // design action
  template?: string;
  primary?: string;
  accent?: string;
  secondary?: string;
  font?: string;
  spacing?: string;
  publicTemplate?: string;
  file?: string;
  cssFile?: string;
  tokensFile?: string;
  headerLayout?: string;
  headerSurface?: string;
  headerDensity?: string;
  headerSticky?: string;
  clearHeader?: boolean;
  dryRun?: boolean;
  tree?: boolean;
};

// Hub templates the backend renders (ClubThemeProvider .club-hub--{name}).
// Mirrors the valid_themes list in club-service routes/club_settings.py.
const VALID_TEMPLATES = [
  "modern", "sport", "elegant", "vibrant", "classic", "minimal", "bold",
  "playful", "glass", "neomorphic", "retro", "neon", "nature", "corporate",
];
const VALID_FONT_PAIRS = ["default", "editorial", "sporty", "friendly", "corporate"];
const VALID_SPACING = ["compact", "normal", "spacious"];
export const VALID_PUBLIC_HEADER_LAYOUTS = ["navigation", "brand-left"] as const;
export const VALID_PUBLIC_HEADER_SURFACES = ["light", "dark", "brand"] as const;
export const VALID_PUBLIC_HEADER_DENSITIES = ["compact", "comfortable"] as const;
// Public-website templates (standalone designed homepages, separate from the hub
// template). Mirrors TEMPLATE_COMPONENTS in web-page PublicClubApp.tsx. Set via
// design_settings.homepage_template → the public site renders the designed shell.
const VALID_PUBLIC_TEMPLATES = [
  "elegance", "sport", "community", "minimal", "festlich", "modern", "classic", "flex",
];

export type PublicHeaderFlagOptions = Pick<
  Opts,
  "headerLayout" | "headerSurface" | "headerDensity" | "headerSticky" | "clearHeader"
>;

function parseBooleanFlag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} muss true oder false sein.`);
}

export function buildPublicHeaderPatch(
  opts: PublicHeaderFlagOptions,
): Record<string, unknown> | null | undefined {
  const header: Record<string, unknown> = {};
  if (opts.headerLayout !== undefined) header.layout = opts.headerLayout;
  if (opts.headerSurface !== undefined) header.surface = opts.headerSurface;
  if (opts.headerDensity !== undefined) header.density = opts.headerDensity;
  const sticky = parseBooleanFlag("--header-sticky", opts.headerSticky);
  if (sticky !== undefined) header.sticky = sticky;
  if (opts.clearHeader && Object.keys(header).length) {
    throw new Error("--clear-header kann nicht mit anderen Header-Optionen kombiniert werden.");
  }
  if (opts.clearHeader) return null;
  return Object.keys(header).length ? header : undefined;
}

export function validatePublicHeader(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("custom_template_config.public_header muss ein Objekt sein.");
  }
  const header = value as Record<string, unknown>;
  const allowedKeys = new Set(["layout", "surface", "density", "sticky"]);
  const unknown = Object.keys(header).filter((key) => !allowedKeys.has(key));
  if (unknown.length) {
    throw new Error(`Unbekannte Public-Header-Felder: ${unknown.join(", ")}.`);
  }
  if (header.layout !== undefined && (
    typeof header.layout !== "string"
    || !VALID_PUBLIC_HEADER_LAYOUTS.includes(header.layout as typeof VALID_PUBLIC_HEADER_LAYOUTS[number])
  )) {
    throw new Error(`Ungueltiges Header-Layout "${header.layout}". Erlaubt: ${VALID_PUBLIC_HEADER_LAYOUTS.join(", ")}.`);
  }
  if (header.surface !== undefined && (
    typeof header.surface !== "string"
    || !VALID_PUBLIC_HEADER_SURFACES.includes(header.surface as typeof VALID_PUBLIC_HEADER_SURFACES[number])
  )) {
    throw new Error(`Ungueltige Header-Oberflaeche "${header.surface}". Erlaubt: ${VALID_PUBLIC_HEADER_SURFACES.join(", ")}.`);
  }
  if (header.density !== undefined && (
    typeof header.density !== "string"
    || !VALID_PUBLIC_HEADER_DENSITIES.includes(header.density as typeof VALID_PUBLIC_HEADER_DENSITIES[number])
  )) {
    throw new Error(`Ungueltige Header-Dichte "${header.density}". Erlaubt: ${VALID_PUBLIC_HEADER_DENSITIES.join(", ")}.`);
  }
  if (header.sticky !== undefined && typeof header.sticky !== "boolean") {
    throw new Error("custom_template_config.public_header.sticky muss Boolean sein.");
  }
}

export function buildClubDesignSettings(opts: Opts): Record<string, unknown> {
  let design: Record<string, unknown>;
  if (opts.file) {
    design = readJsonFile<Record<string, unknown>>(opts.file);
  } else {
    design = {};
    if (opts.template) design.homepage_theme = opts.template;
    if (opts.primary) design.primary_color = opts.primary;
    if (opts.accent) design.accent_color = opts.accent;
    if (opts.secondary) design.secondary_color = opts.secondary;
    if (opts.publicTemplate) design.homepage_template = opts.publicTemplate;
    const ctc: Record<string, unknown> = {};
    if (opts.font) ctc.font_pair = opts.font;
    if (opts.spacing) ctc.spacing = opts.spacing;
    if (Object.keys(ctc).length) design.custom_template_config = ctc;
  }

  if (opts.cssFile) {
    const raw = readFileSync(opts.cssFile, "utf-8");
    design.custom_css = raw.trim() ? raw : null;
  }
  if (opts.tokensFile) {
    design.tokens = readJsonFile<Record<string, unknown>>(opts.tokensFile);
  }

  const publicHeaderPatch = buildPublicHeaderPatch(opts);
  if (publicHeaderPatch !== undefined) {
    const existingConfig = design.custom_template_config;
    const customTemplateConfig = existingConfig && typeof existingConfig === "object" && !Array.isArray(existingConfig)
      ? { ...(existingConfig as Record<string, unknown>) }
      : {};
    const existingHeader = customTemplateConfig.public_header;
    customTemplateConfig.public_header = publicHeaderPatch === null
      ? null
      : {
          ...(existingHeader && typeof existingHeader === "object" && !Array.isArray(existingHeader)
            ? existingHeader as Record<string, unknown>
            : {}),
          ...publicHeaderPatch,
        };
    design.custom_template_config = customTemplateConfig;
  }

  return design;
}

/**
 * `comvenio club <action>` dispatcher. cac cannot do native multi-word commands
 * (Gotcha workflow.md), so we register one "club <action>" command and switch
 * on the action.
 *   club info                       → club basics
 *   club design --template sport ... → write design_settings (theme/colors/font)
 *
 * `design` is the theme/colors lever the homepage look depends on (Layer 1).
 * Without it, every homepage falls back to the raw club color + default render.
 * It writes ClubSettings.design_settings via the deep-merge PUT — only the
 * supplied keys change, everything else in design_settings is preserved.
 */
export function registerClubCommands(cli: CAC): void {
  cli
    .command("club <action> [id]", "Club-Profil, Settings, Abteilungen und Design verwalten")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--search <text>", "list: Vereine nach Name oder Beschreibung suchen")
    .option("--template <name>", `design: Hub-Template (${VALID_TEMPLATES.join("|")})`)
    .option("--primary <hex>", "design: Primaerfarbe (#RRGGBB)")
    .option("--accent <hex>", "design: Akzentfarbe (#RRGGBB)")
    .option("--secondary <hex>", "design: Sekundaerfarbe (#RRGGBB)")
    .option("--font <pair>", `design: Font-Pair (${VALID_FONT_PAIRS.join("|")})`)
    .option("--spacing <mode>", `design: Spacing (${VALID_SPACING.join("|")})`)
    .option("--public-template <id>", `design: oeffentliches Website-Template (${VALID_PUBLIC_TEMPLATES.join("|")})`)
    .option("--file <path>", "design: vollstaendiges design_settings-JSON (statt Flags)")
    .option("--css-file <path>", "design: Agent-CSS (scoped auf .pub-site-root; Server-Gate lehnt url()/@import/position:fixed/z-index>50 ab)")
    .option("--tokens-file <path>", "design: Design-Tokens-JSON (palette/radius/spacing_scale/type_scale/shadow_level; WCAG-Gate serverseitig)")
    .option("--header-layout <mode>", `design: Public-Header-Aufbau (${VALID_PUBLIC_HEADER_LAYOUTS.join("|")})`)
    .option("--header-surface <mode>", `design: Public-Header-Oberflaeche (${VALID_PUBLIC_HEADER_SURFACES.join("|")})`)
    .option("--header-density <mode>", `design: Public-Header-Hoehe (${VALID_PUBLIC_HEADER_DENSITIES.join("|")})`)
    .option("--header-sticky <true|false>", "design: Public-Header beim Scrollen fixieren")
    .option("--clear-header", "design: konfigurierten Public-Header entfernen und Template-Header wiederherstellen")
    .option("--dry-run", "design: nur anzeigen was geschrieben wuerde (kein Write)")
    .option("--tree", "department-list: hierarchischen Abteilungsbaum laden")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: Opts) => {
      const state = await loadState();
      const client = createClient(state);

      switch (action) {
        case "list": {
          const query = opts.search
            ? `?search=${encodeURIComponent(opts.search)}`
            : "";
          const response = await client.service<ClubResponse[]>(
            "club",
            `/clubs/${query}`,
          );
          const needle = opts.search?.trim().toLocaleLowerCase("de");
          const clubs = needle
            ? response.filter((club) => [club.name, club.description]
                .some((value) => typeof value === "string"
                  && value.toLocaleLowerCase("de").includes(needle)))
            : response;
          output(clubs, opts.json, () => JSON.stringify(clubs, null, 2));
          break;
        }

        case "info": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) {
            throw new AuthError(
              'Keine Club-ID im State. Gib "--club <id>" an oder logge dich erneut mit "--club <id>" ein.',
            );
          }
          const club = await client.service<ClubResponse>(
            "club",
            `/clubs/${clubId}`,
          );
          output(club, opts.json, () => {
            const lines: string[] = [];
            lines.push(`Verein:   ${club.name ?? "—"}`);
            if (club.short_name) lines.push(`Kurzname: ${club.short_name}`);
            lines.push(`ID:       ${club.id ?? clubId}`);
            const address = [
              club.address,
              [club.postal_code, club.city].filter(Boolean).join(" "),
              club.country,
            ]
              .filter(Boolean)
              .join(", ");
            if (address) lines.push(`Adresse:  ${address}`);
            if (club.email_address) lines.push(`E-Mail:   ${club.email_address}`);
            if (club.phone_number) lines.push(`Telefon:  ${club.phone_number}`);
            if (club.website_url) lines.push(`Website:  ${club.website_url}`);
            if (club.founded_date)
              lines.push(`Gegruendet: ${club.founded_date}`);
            return lines.join("\n");
          });
          break;
        }

        case "update": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) throw new AuthError("Keine Club-ID im State oder via --club gesetzt.");
          if (!opts.file) throw new Error("club update benoetigt --file <club-update.json>.");
          const body = readJsonFile<Record<string, unknown>>(opts.file);
          const club = await client.put<ClubResponse>("club", `/clubs/${clubId}`, body);
          output(club, opts.json, () => `Club-Profil aktualisiert: ${club.name ?? clubId}.`);
          break;
        }

        case "settings": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) throw new AuthError("Keine Club-ID im State oder via --club gesetzt.");
          const settings = await client.get<Record<string, unknown>>("club", `/clubs/${clubId}/settings`);
          output(settings, opts.json, () => JSON.stringify(settings, null, 2));
          break;
        }

        case "settings-update": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) throw new AuthError("Keine Club-ID im State oder via --club gesetzt.");
          if (!opts.file) throw new Error("club settings-update benoetigt --file <settings-update.json>.");
          const body = readJsonFile<Record<string, unknown>>(opts.file);
          const settings = await client.put<Record<string, unknown>>(
            "club",
            `/clubs/${clubId}/settings`,
            body,
          );
          output(settings, opts.json, () => "Club-Settings aktualisiert.");
          break;
        }

        case "department-list": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) throw new AuthError("Keine Club-ID im State oder via --club gesetzt.");
          const suffix = opts.tree ? "/tree" : "";
          const rows = await client.get<Record<string, unknown>[]>(
            "club",
            `/departments/by_club/${clubId}${suffix}`,
          );
          output(rows, opts.json, () => JSON.stringify(rows, null, 2));
          break;
        }

        case "department-show": {
          if (!id) throw new Error("club department-show <department-id> benoetigt eine ID.");
          const department = await client.get<Record<string, unknown>>(
            "club",
            `/departments/by_dep_id/${id}`,
          );
          output(department, opts.json, () => JSON.stringify(department, null, 2));
          break;
        }

        case "department-add": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) throw new AuthError("Keine Club-ID im State oder via --club gesetzt.");
          if (!opts.file) throw new Error("club department-add benoetigt --file <department.json>.");
          const body = readJsonFile<Record<string, unknown>>(opts.file);
          const department = await client.post<Record<string, unknown>>(
            "club",
            `/departments/${clubId}`,
            body,
          );
          output(department, opts.json, () => `Abteilung angelegt: ${department.name ?? department.id ?? "?"}.`);
          break;
        }

        case "department-update": {
          if (!id) throw new Error("club department-update <department-id> benoetigt eine ID.");
          if (!opts.file) throw new Error("club department-update benoetigt --file <department-update.json>.");
          const body = readJsonFile<Record<string, unknown>>(opts.file);
          const department = await client.put<Record<string, unknown>>(
            "club",
            `/departments/${id}`,
            body,
          );
          output(department, opts.json, () => `Abteilung aktualisiert: ${department.name ?? id}.`);
          break;
        }

        case "department-delete": {
          if (!id) throw new Error("club department-delete <department-id> benoetigt eine ID.");
          await client.del("club", `/departments/${id}`);
          output({ deleted: true, id }, opts.json, () => `Abteilung geloescht: ${id}.`);
          break;
        }

        case "design": {
          const clubId = opts.club ?? state.clubId;
          if (!clubId) {
            throw new AuthError(
              'Keine Club-ID im State. Gib "--club <id>" an oder logge dich erneut mit "--club <id>" ein.',
            );
          }

          // Build the partial design_settings object — only supplied keys.
          // --file wins (full object); otherwise compose from flags.
          const design = buildClubDesignSettings(opts);

          if (Object.keys(design).length === 0) {
            throw new Error(
              "club design braucht mind. ein Design-Feld, eine Header-Option, --file, --css-file oder --tokens-file.",
            );
          }

          // Client-side validation — clearer errors than a silent merge of a typo.
          if (typeof design.homepage_theme === "string" && !VALID_TEMPLATES.includes(design.homepage_theme)) {
            throw new Error(
              `Ungueltiges Template "${design.homepage_theme}". Erlaubt: ${VALID_TEMPLATES.join(", ")}.`,
            );
          }
          const ctc = design.custom_template_config as Record<string, unknown> | undefined;
          if (ctc && typeof ctc.font_pair === "string" && !VALID_FONT_PAIRS.includes(ctc.font_pair)) {
            throw new Error(`Ungueltiges Font-Pair "${ctc.font_pair}". Erlaubt: ${VALID_FONT_PAIRS.join(", ")}.`);
          }
          if (ctc && typeof ctc.spacing === "string" && !VALID_SPACING.includes(ctc.spacing)) {
            throw new Error(`Ungueltiges Spacing "${ctc.spacing}". Erlaubt: ${VALID_SPACING.join(", ")}.`);
          }
          validatePublicHeader(ctc?.public_header);
          if (typeof design.homepage_template === "string" && !VALID_PUBLIC_TEMPLATES.includes(design.homepage_template)) {
            throw new Error(
              `Ungueltiges Public-Template "${design.homepage_template}". Erlaubt: ${VALID_PUBLIC_TEMPLATES.join(", ")}.`,
            );
          }

          if (opts.dryRun) {
            output({ dry_run: true, design_settings: design }, opts.json, () =>
              `Dry-Run — wuerde design_settings setzen:\n${JSON.stringify(design, null, 2)}`,
            );
            break;
          }

          // Deep-merge PUT: only the supplied design_settings keys change.
          const res = await client.put<Record<string, unknown>>(
            "club",
            `/clubs/${clubId}/settings`,
            { design_settings: design },
          );
          output(res, opts.json, () => {
            const parts = [
              design.homepage_theme ? `Theme=${design.homepage_theme}` : "",
              design.homepage_template ? `Template=${design.homepage_template}` : "",
              design.primary_color ? `Primary=${design.primary_color}` : "",
              design.accent_color ? `Accent=${design.accent_color}` : "",
              design.secondary_color ? `Secondary=${design.secondary_color}` : "",
              ctc?.font_pair ? `Font=${ctc.font_pair}` : "",
              ctc?.spacing ? `Spacing=${ctc.spacing}` : "",
              ctc?.public_header === null ? "PublicHeader=entfernt" : ctc?.public_header ? "PublicHeader=gesetzt" : "",
              typeof design.custom_css === "string" ? `CustomCSS=${design.custom_css.length}B` : design.custom_css === null ? "CustomCSS=geloescht" : "",
              design.tokens ? "Tokens=gesetzt" : "",
            ].filter(Boolean);
            return `Design gesetzt (${parts.join(", ")}).`;
          });
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: info, update, settings, settings-update, department-list, department-show, department-add, department-update, department-delete, design`,
          );
      }
    });
}
