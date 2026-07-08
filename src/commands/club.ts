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
  email?: string;
  phone?: string;
  website?: string;
  street?: string;
  house_number?: string;
  zip_code?: string;
  city?: string;
  country?: string;
  founded_year?: number;
  [key: string]: unknown;
};

type Opts = {
  json?: boolean;
  club?: string;
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
  dryRun?: boolean;
};

// Hub templates the backend renders (ClubThemeProvider .club-hub--{name}).
// Mirrors the valid_themes list in club-service routes/club_settings.py.
const VALID_TEMPLATES = [
  "modern", "sport", "elegant", "vibrant", "classic", "minimal", "bold",
  "playful", "glass", "neomorphic", "retro", "neon", "nature", "corporate",
];
const VALID_FONT_PAIRS = ["default", "editorial", "sporty", "friendly", "corporate"];
const VALID_SPACING = ["compact", "normal", "spacious"];
// Public-website templates (standalone designed homepages, separate from the hub
// template). Mirrors TEMPLATE_COMPONENTS in web-page PublicClubApp.tsx. Set via
// design_settings.homepage_template → the public site renders the designed shell.
const VALID_PUBLIC_TEMPLATES = [
  "elegance", "sport", "community", "minimal", "festlich", "modern", "classic", "flex",
];

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
    .command("club <action>", "Club-Operationen: info | design")
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
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
    .option("--dry-run", "design: nur anzeigen was geschrieben wuerde (kein Write)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, opts: Opts) => {
      const state = loadState();
      const client = createClient(state);

      switch (action) {
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
              [club.street, club.house_number].filter(Boolean).join(" "),
              [club.zip_code, club.city].filter(Boolean).join(" "),
              club.country,
            ]
              .filter(Boolean)
              .join(", ");
            if (address) lines.push(`Adresse:  ${address}`);
            if (club.email) lines.push(`E-Mail:   ${club.email}`);
            if (club.phone) lines.push(`Telefon:  ${club.phone}`);
            if (club.website) lines.push(`Website:  ${club.website}`);
            if (club.founded_year)
              lines.push(`Gegruendet: ${club.founded_year}`);
            return lines.join("\n");
          });
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
          // Agent-Design-Engine (Lastenheft 08 G2/G3): dedicated file inputs,
          // composable with --file/flags. Empty file = clear the field.
          if (opts.cssFile) {
            const raw = readFileSync(opts.cssFile, "utf-8");
            design.custom_css = raw.trim() ? raw : null;
          }
          if (opts.tokensFile) {
            design.tokens = readJsonFile<Record<string, unknown>>(opts.tokensFile);
          }

          if (Object.keys(design).length === 0) {
            throw new Error(
              "club design braucht mind. ein Feld (--template/--primary/--accent/--secondary/--font/--spacing), --file, --css-file oder --tokens-file.",
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
              typeof design.custom_css === "string" ? `CustomCSS=${design.custom_css.length}B` : design.custom_css === null ? "CustomCSS=geloescht" : "",
              design.tokens ? "Tokens=gesetzt" : "",
            ].filter(Boolean);
            return `Design gesetzt (${parts.join(", ")}).`;
          });
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: info, design`,
          );
      }
    });
}
