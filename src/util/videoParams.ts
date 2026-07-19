// videoParams.ts (K7) — zod validation for `comvenio news video <template> --params <json>`.
// Runs BEFORE the (expensive) Remotion render; reports field-level errors.
import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "brandColor muss ein Hex-Wert wie #0E847B sein");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "date muss ISO-8601 sein (z.B. 2026-07-08)");

const existingFile = (label: string) =>
  z.string().refine(async (p) => await Bun.file(p).exists(), {
    message: `${label}: Datei nicht gefunden`,
  });

const common = {
  brandColor: hexColor,
  logoPath: existingFile("logoPath").optional(),
};

export const slideshowSchema = z
  .object({
    ...common,
    title: z.string().min(1),
    subtitle: z.string().optional(),
    images: z.array(existingFile("images[]")).min(2, "images: mindestens 2 Bilder"),
    overlays: z.array(z.string()).optional(),
    durationPerImage: z.number().int().min(2).max(10).default(4),
  })
  .refine((v) => !v.overlays || v.overlays.length === v.images.length, {
    message: "overlays: Länge muss images entsprechen",
    path: ["overlays"],
  });

export const resultSchema = z.object({
  ...common,
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
  competition: z.string().optional(),
  scorers: z.array(z.string()).optional(),
  date: isoDate.optional(),
});

export const teaserSchema = z.object({
  ...common,
  title: z.string().min(1),
  date: isoDate,
  location: z.string().optional(),
  ctaText: z.string().optional(),
  backgroundImage: existingFile("backgroundImage").optional(),
});

const highlightItem = z.object({
  label: z.string().optional(),
  text: z.string().min(1),
  logo: existingFile("items[].logo").optional(),
});

const highlightPartner = z.object({
  name: z.string().min(1),
  subtitle: z.string().optional(),
  logo: existingFile("partners[].logo").optional(),
});

export const highlightSchema = z.object({
  ...common,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  orgName: z.string().optional(),
  dateRange: z.string().optional(),
  kicker: z.string().optional(),
  itemsHeading: z.string().optional(),
  items: z.array(highlightItem).max(3).optional(),
  partners: z.array(highlightPartner).max(2).optional(),
  noteText: z.string().optional(),
  closingText: z.string().optional(),
  background: existingFile("background").optional(),
  logo: existingFile("logo").optional(),
  heroImage: existingFile("heroImage").optional(),
  sponsors: z.array(existingFile("sponsors[]")).optional(),
  greenColor: hexColor.optional(),
  creamColor: hexColor.optional(),
  goldColor: hexColor.optional(),
});

export const VIDEO_TEMPLATES = ["slideshow", "result", "teaser", "highlight"] as const;
export type VideoTemplate = (typeof VIDEO_TEMPLATES)[number];

const SCHEMAS: Record<VideoTemplate, z.ZodTypeAny> = {
  slideshow: slideshowSchema,
  result: resultSchema,
  teaser: teaserSchema,
  highlight: highlightSchema,
};

export function isVideoTemplate(v: string): v is VideoTemplate {
  return (VIDEO_TEMPLATES as readonly string[]).includes(v);
}

/** Validates params for a template. Throws Error with readable field errors. */
export async function validateVideoParams(
  template: VideoTemplate,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const result = await SCHEMAS[template].safeParseAsync(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`Ungültige Params für Template "${template}":\n${lines.join("\n")}`);
  }
  return result.data as Record<string, unknown>;
}
