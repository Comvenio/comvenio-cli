import { z } from "zod";

import { K12_HOMEPAGE_REGISTRY, K12_SCHEMA_DOMAINS } from "./schema-registry.ts";
import type { K12ActionId, K12ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(200);
const text = z.string().max(200_000);
const isoDateTime = z.string().datetime({ offset: true });
const pagination = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) } as const;
const contextType = z.enum(["none", "club", "department", "event", "object", "task", "news", "paper", "newsletter", "tournament", "protocol", "agenda_item", "agenda_item_note", "protocol_entry", "user_avatar", "message_attachment", "feedback", "certificate", "certificate_template", "letter", "event_sponsor", "advertiser", "sponsorship_product", "sponsorship_assignment"]);
const httpsUrl = z.string().url().max(2_000).refine((value) => value.startsWith("https://"), "Nur HTTPS-URLs sind erlaubt.");
const externalHttpsUrl = httpsUrl.refine((value) => {
  const host = new URL(value).hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(?:127|10|0)\./u.test(host) || /^169\.254\./u.test(host) || /^192\.168\./u.test(host)) return false;
  const match = host.match(/^172\.(\d{1,3})\./u);
  return !match || Number(match[1]) < 16 || Number(match[1]) > 31;
}, "Lokale, private oder Link-Local-Ziele sind nicht erlaubt.");
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(512) }).strict();
const base = { club_id: uuid, department_id: uuid.nullable().optional(), confirmation: confirmation.optional() } as const;
const single = <S extends z.ZodRawShape>(shape: S) => z.object({ ...base, ...shape }).strict();
const grouped = <S extends z.ZodRawShape>(operation: string, shape: S) => z.object({ ...base, operation: z.literal(operation), ...shape }).strict();
const union = <T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>(items: T) => z.discriminatedUnion("operation", items as never);
const contract = (input: z.ZodType): K12ActionSchemaContract => ({ input, output: z.json() });

function safeRichHtml(value: string): boolean {
  if (/<\s*script|javascript\s*:|data\s*:\s*text\/html|\son[a-z]+\s*=/iu.test(value)) return false;
  const iframes = [...value.matchAll(/<iframe[^>]+src=["']([^"']+)["']/giu)].map((match) => match[1]!);
  return iframes.every((url) => /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+(?:\?[^"']*)?$/u.test(url));
}
const richHtml = text.refine(safeRichHtml, "Aktive Skripte, Event-Handler und nicht freigegebene Iframes sind nicht erlaubt.");
const safeString = z.string().max(10_000).refine((value) => !/(?:[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\/)/u.test(value), "Lokale Dateipfade sind nicht erlaubt.");

const widgetKinds = K12_HOMEPAGE_REGISTRY.widget_kinds as [string, ...string[]];
const widgetFields = Object.fromEntries(Object.values(K12_HOMEPAGE_REGISTRY.widgets).flatMap((entry) => entry.config.map((field) => [field.name, z.json().optional()]))) as z.ZodRawShape;
const widgetFieldsByKind = new Map(Object.entries(K12_HOMEPAGE_REGISTRY.widgets).map(([kind, entry]) => [kind, new Set(entry.config.map((field) => field.name))]));
const widgetConfig = z.object(widgetFields).strict();
const homepageWidget = z.object({ kind: z.enum(widgetKinds), title: z.string().max(200).nullable().optional(), config: widgetConfig.default({}), slot_index: z.number().int().min(0).max(100).default(0) }).strict().superRefine((value, ctx) => {
  const allowed = widgetFieldsByKind.get(value.kind) ?? new Set<string>();
  for (const key of Object.keys(value.config)) if (!allowed.has(key)) ctx.addIssue({ code: "custom", path: ["config", key], message: `Das Feld ist für ${value.kind} nicht freigegeben.` });
  const serialized = JSON.stringify(value.config);
  if (/(?:[A-Za-z]:\\|file:\/\/|javascript\s*:|<\s*script|\son[a-z]+\s*=)/iu.test(serialized)) ctx.addIssue({ code: "custom", path: ["config"], message: "Lokale Pfade oder aktive Inhalte sind nicht erlaubt." });
});
const homepageSection = z.object({
  layout: z.enum(["full", "two-col", "three-col", "four-col", "sidebar-left", "sidebar-right", "asymmetric-left", "asymmetric-right"]).default("full"),
  style_variant: z.enum(["default", "primary", "dark", "subtle", "gradient", "glass", "image"]).default("default"),
  sort_order: z.number().int().min(0).max(10_000).default(0), title: z.string().max(200).nullable().optional(), is_visible: z.boolean().default(true), bg_image_url: httpsUrl.nullable().optional(), widgets: z.array(homepageWidget).max(100).default([]),
}).strict();
const homepageTab = z.object({
  label: z.string().trim().min(1).max(100), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(100), icon: z.string().max(100).nullable().optional(), navigation_group: z.string().trim().max(100).nullable().optional(), position: z.number().int().min(0).max(10_000).default(0), visibility_scope: z.enum(["public", "member", "department"]).default("public"), department_id: uuid.nullable().optional(), sections: z.array(homepageSection).max(50).default([]),
}).strict().refine((tab) => tab.visibility_scope === "department" ? Boolean(tab.department_id) : tab.department_id === undefined || tab.department_id === null, "Abteilungs-ID und Sichtbarkeit müssen zusammenpassen.");
const homepage = { tabs: z.array(homepageTab).min(1).max(30), clear_existing: z.boolean().default(false) } as const;

const verifyOptions = { viewports: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop", "mobile"]), audit: z.boolean().default(true), wait_ms: z.number().int().min(0).max(10_000).default(1_500) } as const;
const fileReference = { source_file_id: uuid, filename: safeString.max(255), content_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu), expected_size: z.number().int().min(1).max(209_715_200) } as const;
const fileChange = z.object({ context_type: contextType.nullable().optional(), context_id: uuid.nullable().optional(), sub_context_id: uuid.nullable().optional(), context_label: z.string().max(500).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0);
const folderRight = z.object({ folder_id: uuid, subject_type: z.enum(["user", "group"]), subject_id: uuid, can_read: z.boolean().default(true), can_write: z.boolean().default(false) }).strict();
const paper = z.object({ title: short, description: z.string().max(2_000).nullable().optional(), document_type: z.enum(["protokoll", "flyer", "anleitung", "zeitung", "bericht", "speisekarte", "sonstiges"]), context_type: z.enum(["event", "object", "task", "supply", "custom"]), context_id: uuid, file_id: uuid, published_at: isoDateTime.nullable().optional() }).strict();

const referenceType = z.enum(["none", "event", "tournament", "task", "meeting", "object", "external_url"]);
const newsFields = {
  title: short, content: richHtml, teaser: z.string().max(2_000).nullable().optional(), cover_image_file_id: uuid.nullable().optional(), category_id: uuid.nullable().optional(), club_department_id: uuid.nullable().optional(), visibility_scope: z.enum(["public", "member", "department"]).default("member"), is_pinned: z.boolean().default(false), reference_id: uuid.nullable().optional(), reference_type: referenceType.default("none"), reference_url: httpsUrl.nullable().optional(), reference_label: z.string().max(200).nullable().optional(), design_source: z.enum(["webapp", "cli"]).default("cli"),
} as const;
const news = z.object(newsFields).strict().refine((value) => value.visibility_scope === "department" ? Boolean(value.club_department_id) : true).refine((value) => value.reference_type === "external_url" ? Boolean(value.reference_url) : true);
const newsChanges = z.object({ title: short.optional(), content: richHtml.optional(), teaser: z.string().max(2_000).nullable().optional(), cover_image_file_id: uuid.nullable().optional(), category_id: uuid.nullable().optional(), club_department_id: uuid.nullable().optional(), visibility_scope: z.enum(["public", "member", "department"]).optional(), is_pinned: z.boolean().optional(), reference_id: uuid.nullable().optional(), reference_type: referenceType.optional(), reference_url: httpsUrl.nullable().optional(), reference_label: z.string().max(200).nullable().optional(), design_source: z.enum(["webapp", "cli"]).optional() }).strict().refine((value) => Object.keys(value).length > 0);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const remoteAsset = uuid;
const videoInput = z.union([
  grouped("render", { template: z.literal("slideshow"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), title: short, subtitle: z.string().max(300).optional(), image_file_ids: z.array(remoteAsset).min(2).max(100), overlays: z.array(z.string().max(300)).max(100).optional(), duration_per_image: z.number().int().min(2).max(10).default(4) }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render", { template: z.literal("result"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), home_team: short, away_team: short, home_score: z.number().int().min(0).max(999), away_score: z.number().int().min(0).max(999), competition: z.string().max(200).optional(), scorers: z.array(z.string().max(200)).max(100).optional(), date: z.string().date().optional() }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render", { template: z.literal("teaser"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), title: short, date: z.string().date(), location: z.string().max(300).optional(), cta_text: z.string().max(200).optional(), background_file_id: remoteAsset.optional() }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render", { template: z.literal("highlight"), params: z.object({ brandColor: hex, logo_file_id: remoteAsset.optional(), title: short, subtitle: z.string().max(300).optional(), hero_file_id: remoteAsset.optional(), sponsor_file_ids: z.array(remoteAsset).max(20).optional(), note_text: z.string().max(1_000).optional() }).strict(), duration_seconds: z.number().int().min(3).max(600).optional() }),
  grouped("render_and_upload", { template: z.enum(["slideshow", "result", "teaser", "highlight"]), render_request_id: uuid, context_type: contextType.default("news"), context_id: uuid.optional(), visibility: z.enum(["private", "public"]).default("private") }),
]);

export const K12_ACTION_SCHEMAS: Readonly<Record<K12ActionId, K12ActionSchemaContract>> = Object.freeze({
  "cai.homepage.01.preview": contract(single({ ...homepage })),
  "cai.homepage.02.apply": contract(single({ ...homepage })),
  // Kein `tabs` im Eingang: Gerendert wird eine BEREITS gespeicherte Vorschau.
  // Wer eine neue braucht, legt sie mit cai.homepage.01.preview an — sonst
  // gaebe es zwei Wege, dieselbe Struktur zu uebergeben, und einer davon
  // liefe an der 30-Minuten-Gueltigkeit vorbei.
  "cai.homepage.04.screenshot": contract(single({ preview_id: uuid, viewports: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop", "mobile"]), tab_slug: z.string().trim().max(100).nullable().optional(), settle_ms: z.number().int().min(0).max(10_000).default(1_500) })),
  "cai.homepage.03.show": contract(union([grouped("private", {}), grouped("public", {})])),
  "cai.schema.01.list_domains": contract(single({})),
  "cai.schema.02.show_domain_schema": contract(single({ domain: z.enum(K12_SCHEMA_DOMAINS) })),
  "cai.verify.01.url": contract(single({ target_url: externalHttpsUrl, ...verifyOptions })),
  "cai.verify.02.event": contract(single({ event_id: uuid, child_event_id: uuid.optional(), area_id: uuid.optional(), ...verifyOptions })),
  "cai.verify.03.menu": contract(single({ menu_id: uuid, print_view: z.boolean().default(false), ...verifyOptions })),
  "cai.verify.04.homepage": contract(union([grouped("live", { ...verifyOptions }), grouped("preview", { tabs: homepage.tabs, ...verifyOptions })])),
  "cai.verify.05.news": contract(single({ news_id: uuid, ...verifyOptions })),
  "cai.verify.06.certificate": contract(single({ honor_id: uuid, ...verifyOptions })),
  "cai.data.01.list": contract(single({ context_type: contextType, context_id: uuid, sub_context_id: uuid.optional(), include_deleted: z.boolean().default(false), ...pagination })),
  "cai.data.02.show": contract(single({ file_id: uuid })),
  "cai.data.03.update": contract(single({ file_id: uuid, changes: fileChange })),
  "cai.data.04.url": contract(single({ file_id: uuid })),
  "cai.data.05.download": contract(single({ file_id: uuid, preferred_name: safeString.max(255).optional() })),
  "cai.data.06.upload": contract(single({ ...fileReference, context_type: contextType, context_id: uuid.optional(), sub_context_id: uuid.optional(), context_label: z.string().max(500).optional(), visibility: z.enum(["private", "public"]).default("private") })),
  "cai.data.07.delete": contract(union([grouped("soft_delete", { file_id: uuid }), grouped("hard_delete", { file_id: uuid })])),
  "cai.data.08.restore": contract(single({ file_id: uuid })),
  "cai.data.09.move": contract(single({ file_id: uuid, target_folder_id: uuid.nullable() })),
  "cai.data.10.visibility": contract(union([grouped("private", { file_id: uuid }), grouped("public", { file_id: uuid })])),
  "cai.data.11.stats": contract(single({})),
  "cai.data.12.empty_trash": contract(single({ folder_id: uuid.nullable().optional() })),
  "cai.data.13.area_media": contract(single({ area_ids: z.array(uuid).min(1).max(100), label: z.enum(["title_picture", "flyer"]).optional() })),
  "cai.data.14.area_shares": contract(single({ file_id: uuid })),
  "cai.data.15.area_share_add": contract(single({ file_id: uuid, area_ids: z.array(uuid).min(1).max(100) })),
  "cai.data.16.area_share_remove": contract(single({ file_id: uuid, area_id: uuid })),
  "cai.data.17.children": contract(single({ parent_id: uuid.nullable().optional(), include_deleted: z.boolean().default(false), ...pagination })),
  "cai.data.18.search": contract(single({ folder_id: uuid.nullable().optional(), query: z.string().trim().min(1).max(200), recursive: z.boolean().default(true), ...pagination })),
  "cai.data.19.breadcrumb": contract(single({ folder_id: uuid })),
  "cai.data.20.folder_create": contract(single({ parent_id: uuid.nullable().optional(), name: short.max(255), is_protected: z.boolean().default(false) })),
  "cai.data.21.folder_rename": contract(single({ folder_id: uuid, new_name: short.max(255) })),
  "cai.data.22.folder_move": contract(single({ folder_id: uuid, new_parent_id: uuid.nullable() })),
  "cai.data.23.folder_protect": contract(single({ folder_id: uuid, protect: z.boolean() })),
  "cai.data.24.folder_delete": contract(single({ folder_id: uuid, recursive: z.boolean().default(true) })),
  "cai.data.25.folder_restore": contract(single({ folder_id: uuid, recursive: z.boolean().default(true) })),
  "cai.data.26.folder_rights": contract(single({ folder_id: uuid })),
  "cai.data.27.folder_right_add": contract(single({ right: folderRight })),
  "cai.data.28.folder_right_bulk": contract(single({ rights: z.array(folderRight).min(1).max(100) })),
  "cai.data.29.folder_right_delete": contract(single({ right_id: uuid })),
  "cai.data.30.papers": contract(single({ context_type: z.enum(["event", "object", "task", "supply", "custom"]).optional(), context_id: uuid.optional(), document_type: z.enum(["protokoll", "flyer", "anleitung", "zeitung", "bericht", "speisekarte", "sonstiges"]).optional(), ...pagination }).refine((value) => Boolean(value.context_type) === Boolean(value.context_id), "Kontexttyp und Kontext-ID müssen gemeinsam gesetzt werden.")),
  "cai.data.31.paper_show": contract(single({ paper_id: uuid })),
  "cai.data.32.paper_add": contract(single({ paper })),
  "cai.data.33.paper_update": contract(single({ paper_id: uuid, paper })),
  "cai.data.34.paper_delete": contract(single({ paper_id: uuid })),
  "cai.data.35.export_members_bookings": contract(union([grouped("members", { format: z.enum(["csv", "xlsx"]).default("csv") }), grouped("bookings", { format: z.enum(["csv", "xlsx"]).default("csv") })])),
  "cai.news.01.list": contract(union([grouped("private", { ...pagination }), grouped("public", { ...pagination })])),
  "cai.news.02.show": contract(union([grouped("private", { news_id: uuid }), grouped("public", { news_id: uuid })])),
  "cai.news.03.create": contract(union([grouped("draft", { news }), grouped("publish", { news })])),
  "cai.news.04.update": contract(single({ news_id: uuid, changes: newsChanges })),
  "cai.news.05.delete": contract(single({ news_id: uuid })),
  "cai.news.06.apply": contract(union([grouped("draft", { news }), grouped("publish", { news })])),
  "cai.news.07.preview": contract(single({ title: short, content: richHtml, teaser: z.string().max(2_000).nullable().optional(), cover_file_id: uuid.optional(), author_name: z.string().max(200).optional(), club_name: z.string().max(200).optional() })),
  "cai.news.08.publish": contract(single({ news_id: uuid })),
  "cai.news.09.video_slideshow_result_teaser": contract(videoInput),
});
