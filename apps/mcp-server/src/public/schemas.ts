import { z } from "zod";

import type { PublicResolverAlias } from "./types.ts";

const uuid = z.string().uuid();
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).min(3).max(100);
const domain = z.string().trim().toLowerCase().max(253).refine((value) => {
  try {
    const url = new URL(`https://${value}`);
    return url.hostname === value && !url.port && value.includes(".");
  } catch {
    return false;
  }
}, "Domain ist ungültig.");
const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Zeitpunkt ist ungültig.");
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "URL muss HTTPS verwenden.");

export const PUBLIC_INPUT_SCHEMAS: Readonly<Record<PublicResolverAlias, z.ZodType>> = Object.freeze({
  public_club_by_slug: z.object({ slug }).strict(),
  public_club_by_domain: z.object({ domain }).strict(),
  public_club_profile: z.object({ club_id: uuid }).strict(),
  public_club_home: z.object({ club_id: uuid }).strict(),
  public_club_legal: z.object({ club_id: uuid }).strict(),
  public_events: z.object({
    club_id: uuid,
    from: instant,
    to: instant,
    limit: z.number().int().min(1).max(100).default(100),
  }).strict().refine((value) => Date.parse(value.from) < Date.parse(value.to), {
    message: "Das öffentliche Event-Zeitfenster ist ungültig.",
  }),
  public_event_attachments: z.object({ event_id: uuid }).strict(),
  public_training: z.object({ club_id: uuid, limit: z.number().int().min(1).max(100).default(50) }).strict(),
  public_news: z.object({ club_id: uuid, limit: z.number().int().min(1).max(100).default(20) }).strict(),
  public_news_detail: z.object({ news_id: uuid }).strict(),
  public_department_news: z.object({
    club_id: uuid,
    department_id: uuid,
    limit: z.number().int().min(1).max(100).default(20),
  }).strict(),
  public_menu: z.object({ club_id: uuid, menu_id: uuid }).strict(),
  public_event_menu: z.object({ event_id: uuid }).strict(),
  public_sponsors: z.object({
    club_id: uuid,
    advertiser_ids: z.array(uuid).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
    publication_source: z.enum(["homepage", "event"]),
    publication_version: z.string().min(1).max(128),
  }).strict(),
});

const publicClubView = z.object({
  name: z.string().trim().min(1).max(300),
  slug: slug,
}).strict();

const publicProfile = z.object({
  club_id: uuid,
  name: z.string(),
  short_name: z.string().nullable(),
  description: z.string().nullable(),
  logo_url: httpsUrl.nullable(),
  public_contact: z.object({
    website: httpsUrl.nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
  }).strict().nullable(),
}).strict();

const publicLegal = z.object({
  club_name: z.string(),
  legal_form: z.string().nullable(),
  register_number: z.string().nullable(),
  address: z.string().nullable(),
  postal_code: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  responsible_label: z.string(),
  responsibility_text: z.string(),
}).strict();

const publicEvent = z.object({
  id: uuid,
  title: z.string(),
  summary: z.string().nullable(),
  start: instant.nullable(),
  end: instant.nullable(),
  timezone: z.string(),
  location: z.string().nullable(),
  is_public: z.literal(true),
  cover_url: httpsUrl.nullable(),
}).strict();

const publicAttachment = z.object({
  id: uuid,
  name: z.string(),
  mime_type: z.string(),
  size: z.number().int().nonnegative(),
  url: httpsUrl,
}).strict();

const publicTraining = z.object({
  id: uuid,
  title: z.string(),
  location: z.string().nullable(),
  start: instant.nullable(),
  end: instant.nullable(),
}).strict();

const publicNews = z.object({
  id: uuid,
  title: z.string(),
  summary: z.string(),
  sanitized_html: z.string().nullable(),
  hero_url: httpsUrl.nullable(),
  published_at: instant,
  author_display_name: z.string().nullable(),
}).strict();

const publicMenuItem = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().nonnegative().nullable(),
  category: z.string().nullable(),
  type: z.string().nullable(),
  is_available: z.boolean(),
}).strict();

const publicMenu = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  design: z.null(),
  items: z.array(publicMenuItem),
}).strict();

const publicSponsor = z.object({
  advertiser_id: uuid,
  display_name: z.string(),
  logo_url: httpsUrl.nullable(),
  target_url: httpsUrl.nullable(),
  label: z.string().nullable(),
}).strict();

const publicHome = z.object({
  tabs: z.array(z.object({
    id: uuid,
    label: z.string(),
    slug,
    icon: z.string().nullable(),
    navigation_group: z.string().nullable(),
    position: z.number().int().nonnegative(),
    widgets: z.array(z.object({
      id: uuid,
      kind: z.string(),
      title: z.string().nullable(),
      position: z.number().int().nonnegative(),
    }).strict()),
  }).strict()),
}).strict();

export const PUBLIC_OUTPUT_SCHEMAS: Readonly<Record<PublicResolverAlias, z.ZodType>> = Object.freeze({
  public_club_by_slug: publicClubView,
  public_club_by_domain: publicClubView,
  public_club_profile: publicProfile,
  public_club_home: publicHome,
  public_club_legal: publicLegal,
  public_events: z.array(publicEvent),
  public_event_attachments: z.array(publicAttachment),
  public_training: z.array(publicTraining),
  public_news: z.array(publicNews),
  public_news_detail: publicNews,
  public_department_news: z.array(publicNews),
  public_menu: publicMenu,
  public_event_menu: publicMenu,
  public_sponsors: z.array(publicSponsor),
});
