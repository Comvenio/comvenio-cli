export const HOMEPAGE_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

export type HomepageViewport = (typeof HOMEPAGE_VIEWPORTS)[number];

export type HomepageWidget = {
  kind?: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
};

export type HomepageSection = {
  is_visible?: boolean;
  widgets?: HomepageWidget[];
};

export type HomepageTab = {
  id?: string;
  label?: string;
  slug?: string;
  position?: number;
  visibility_scope?: string;
  is_active?: boolean;
  widgets?: HomepageWidget[];
  sections?: HomepageSection[];
};

export type LiveHomepageClub = {
  subdomain?: unknown;
  [key: string]: unknown;
};

/**
 * Re-point an absolute preview URL at a different renderer.
 *
 * The club-service returns the preview URL absolute, always pointing at the
 * hosted frontend. Anyone passing --frontend-base wants a DIFFERENT renderer —
 * in practice a local dev server carrying code that is not merged yet. Path and
 * query stay, the origin comes from the base.
 *
 * Built on `new URL` rather than string work on purpose: URL syntax has an
 * unbounded edge-case space, and the language already knows it.
 */
export function applyFrontendBase(previewUrl: string, base: string): string {
  const ziel = new URL(previewUrl);
  return new URL(`${ziel.pathname}${ziel.search}`, base).toString();
}

/** Resolve the managed public homepage address exclusively from Club.subdomain. */
export function resolveLiveHomepageUrl(
  environment: string,
  club: LiveHomepageClub,
): string {
  const subdomain = typeof club.subdomain === "string"
    ? club.subdomain.trim().toLowerCase()
    : "";
  if (!subdomain) {
    throw new Error(
      "Der Verein hat noch keine Comvenio-Adresse. Lege zuerst die Comvenio-Subdomain " +
      "in den Vereins-Einstellungen fest, oder nutze `verify homepage --file home.json` für einen Entwurf.",
    );
  }
  if (
    subdomain.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)
  ) {
    throw new Error(
      "Die gespeicherte Comvenio-Subdomain ist kein gültiges DNS-Label. " +
        "Korrigiere die Comvenio-Adresse in den Vereins-Einstellungen.",
    );
  }

  const suffix = environment === "dev" ? "web.dev.comvenio.app" : "web.comvenio.app";
  return `https://${subdomain}.${suffix}`;
}

export type VerifyFinding = {
  kind:
    | "horizontal_overflow"
    | "empty_main"
    | "invisible_text"
    | "contrast"
    | "console_error"
    | "same_origin_request"
    | "missing_legal_footer"
    | "invalid_legal_footer_link"
    | "imprint_unavailable"
    | "invalid_imprint_content";
  message: string;
  tab: string;
  viewport: string;
  details?: Record<string, unknown>;
};

export type UnverifiableFinding = {
  kind: "unverifiable_background";
  message: string;
  tab: string;
  viewport: string;
  details?: Record<string, unknown>;
};

export function normalizeHomepageTabs(tabs: readonly HomepageTab[]): Required<Pick<HomepageTab, "label" | "slug">>[] {
  return tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab }) => tab.is_active !== false && (tab.visibility_scope ?? "public") === "public")
    .sort((a, b) => (a.tab.position ?? Number.MAX_SAFE_INTEGER) - (b.tab.position ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ tab }, index) => ({
      label: tab.label?.trim() || `Seite ${index + 1}`,
      slug: tab.slug?.trim() || (tab.label?.trim() || `seite-${index + 1}`).toLowerCase().replace(/\s+/g, "-"),
    }));
}

export function withTabQuery(baseUrl: string, slug: string): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("page");
  url.searchParams.set("tab", slug);
  return url.toString();
}

export function withImprintRoute(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("tab");
  if (url.pathname.includes("/home-preview/")) {
    url.searchParams.set("page", "impressum");
  } else {
    url.pathname = "/impressum";
    url.search = "";
  }
  return url.toString();
}

export function sanitizeArtifactUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|auth|key|secret|signature/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function artifactSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

export function classifyVerificationExit(incomplete: boolean, failures: number): 0 | 2 | 4 {
  if (incomplete) return 2;
  return failures > 0 ? 4 : 0;
}

const CONSOLE_ALLOWLIST = [
  /favicon/i,
  /resizeobserver loop/i,
  /chrome-extension:/i,
  /moz-extension:/i,
];

export function actionableConsoleErrors(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /error|uncaught|failed|exception/i.test(line))
    .filter((line) => !/^total messages:/i.test(line))
    .filter((line) => !CONSOLE_ALLOWLIST.some((allowed) => allowed.test(line)));
}

export function failedSameOriginRequests(output: string, pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\b[45]\d{2}\b/.test(line))
    .filter((line) => {
      const rawUrl = line.match(/https?:\/\/[^\s\])]+/)?.[0];
      if (!rawUrl) return false;
      try {
        return new URL(rawUrl).origin === origin && !/\/favicon(?:\.ico)?(?:\?|\s|$)/i.test(rawUrl);
      } catch {
        return false;
      }
    });
}

export function selectHomepageViewports(
  desktopOnly?: boolean,
  mobileOnly?: boolean,
): readonly HomepageViewport[] {
  if (desktopOnly) return HOMEPAGE_VIEWPORTS.filter((viewport) => viewport.width >= 1024);
  if (mobileOnly) return HOMEPAGE_VIEWPORTS.filter((viewport) => viewport.width <= 768);
  return HOMEPAGE_VIEWPORTS;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  *
 * Diese drei Funktionen liefen bis zum 2026-08-31 ausschliesslich als TEXT im
 * Browser: `HOMEPAGE_AUDIT_JS` in `commands/verify.ts` ist ein Template-Literal,
 * das als Kommandozeilen-Argument an das Playwright-CLI geht. Damit waren sie
 * nicht testbar — und genau das war die einzige offene Zeile der Definition of
 * Done (AK-B-02 / TC-11-05).
 *
 * Sie stehen jetzt hier als normale Funktionen und werden dort per
 * `.toString()` in den Skripttext eingesetzt. **Eine Quelle:** Was der Test
 * prueft, ist derselbe Code, den der Browser ausfuehrt.
 *
 * Zwei Bedingungen, beide gemessen (2026-08-31):
 *   - Der Skripttext wird mit `.replace(/\s+/g, " ")` komprimiert. Ein
 *     `//`-Kommentar wuerde dabei den Rest der Zeile verschlucken — Bun
 *     entfernt Kommentare aber beim Transpilieren, also kommt keiner an.
 *   - `toString()` liefert transpiliertes JavaScript ohne Typannotationen.
 *
 * Deshalb duerfen diese Funktionen **nichts referenzieren, was ausserhalb von
 * ihnen steht** — kein Import, keine Konstante des Moduls. Im Browser gibt es
 * das nicht.
 * ────────────────────────────────────────────────────────────────────────── */

export type AuditFarbe = { r: number; g: number; b: number; a: number };

/**
 * Eine CSS-Farbe in Kanäle zerlegen — oder `null`, wenn es keine ist.
 *
 * `null` ist die wichtigste Antwort dieser Funktion: Ein Bild, ein Verlauf
 * oder eine nicht parsebare Angabe fuehrt im Audit zu
 * `unverifiable_background` statt zu einem Kontrast-Urteil. Genau das
 * verlangt §4.1 — "nie als Pass oder Fail zaehlen".
 */
export function auditToRGB(value: string | null | undefined): AuditFarbe | null {
  if (!value || !value.startsWith("rgb")) return null;
  const values = value
    .slice(value.indexOf("(") + 1, value.indexOf(")"))
    .split(",")
    .map(Number);
  if (values.length < 3 || values.some((item) => Number.isNaN(item))) return null;
  return { r: values[0]!, g: values[1]!, b: values[2]!, a: values[3] ?? 1 };
}

/** Relative Leuchtdichte nach WCAG 2.1. */
export function auditLuminance(color: AuditFarbe): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Kontrastverhaeltnis zweier Farben — 1 bis 21. */
export function auditContrastRatio(foreground: AuditFarbe, background: AuditFarbe): number {
  const a = auditLuminance(foreground);
  const b = auditLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Ist der Text "gross" im Sinne von WCAG? Dann genuegt 3:1 statt 4.5:1.
 *
 * Die Schwellen stehen in §4.1: "normale Schrift 4.5:1, grosse Schrift/UI
 * 3:1". Gross ist ab 24px, oder ab 18.66px bei Fettschrift.
 */
export function auditIstGrosseSchrift(fontSize: number, fontWeight: number): boolean {
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}

/** Die geforderte Mindestschwelle fuer ein Kontrastverhaeltnis. */
export function auditKontrastSchwelle(gross: boolean): number {
  return gross ? 3 : 4.5;
}
