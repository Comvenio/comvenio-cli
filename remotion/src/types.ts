// Prop types for the 3 fixed templates (K7). The CLI validates user params with zod
// BEFORE rendering (src/util/videoParams.ts) and stages assets into remotion/public/,
// so image/logo props here are staticFile()-relative paths inside the job folder.

export type CommonBranding = {
  brandColor: string; // hex accent color, e.g. "#0E847B"
  logoFile?: string; // staticFile-relative path (staged by render.mjs), optional
  durationOverride?: number; // seconds — overrides the template default duration
};

export type SlideshowProps = CommonBranding & {
  title: string;
  subtitle?: string;
  images: string[]; // staticFile-relative paths (min. 2)
  overlays?: string[]; // one text per image (optional)
  durationPerImage: number; // seconds per image (2-10, default 4)
};

export type ResultProps = CommonBranding & {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  competition?: string;
  scorers?: string[]; // plain text entries, e.g. "Max Muster (23.)"
  date?: string; // ISO-8601
};

export type TeaserProps = CommonBranding & {
  title: string;
  date: string; // ISO-8601
  location?: string;
  ctaText?: string;
  backgroundImage?: string; // staticFile-relative path (optional)
  daysUntil?: number; // computed deterministically by render.mjs (countdown look)
};

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const SLIDESHOW_INTRO_SECONDS = 2.5;
export const SLIDESHOW_MIN_SECONDS = 8;
export const RESULT_DEFAULT_SECONDS = 12;
export const TEASER_DEFAULT_SECONDS = 10;

export function slideshowDurationSeconds(p: SlideshowProps): number {
  if (p.durationOverride) return p.durationOverride;
  const total = SLIDESHOW_INTRO_SECONDS + p.images.length * p.durationPerImage;
  return Math.max(SLIDESHOW_MIN_SECONDS, total);
}
