import { z } from "zod";
import type { K13ActionId, K13ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(200);
const long = z.string().max(20_000);
const instant = z.string().datetime({ offset: true });
const httpsUrl = z.string().url().max(2_000).refine((value) => {
  const url = new URL(value); const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(?:0|10|127|169\.254|192\.168)\./u.test(host)) return false;
  const match = host.match(/^172\.(\d{1,3})\./u); return !match || Number(match[1]) < 16 || Number(match[1]) > 31;
}, "Nur öffentliche HTTPS-URLs sind erlaubt.");
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(512) }).strict();
const base = { club_id: uuid, department_id: uuid.nullable().optional(), confirmation: confirmation.optional() } as const;
const single = <S extends z.ZodRawShape>(shape: S) => z.object({ ...base, ...shape }).strict();
const grouped = <S extends z.ZodRawShape>(operation: string, shape: S) => z.object({ ...base, operation: z.literal(operation), ...shape }).strict();
const union = <T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>(items: T) => z.discriminatedUnion("operation", items as never);
const contract = (input: z.ZodType): K13ActionSchemaContract => ({ input, output: z.json() });
const nonEmpty = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().refine((value) => Object.keys(value).length > 0, "Mindestens ein Änderungsfeld ist erforderlich.");
const cents = z.number().int().min(0).max(1_000_000_000);
const currency = z.string().regex(/^[A-Z]{3}$/u).default("EUR");
const billing = z.enum(["year", "month", "one_time"]);
const remoteAsset = z.object({ source_file_id: uuid, filename: z.string().trim().min(1).max(255).refine((value) => !/(?:[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\/)/u.test(value), "Lokale Dateipfade sind nicht erlaubt."), content_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu), expected_size: z.number().int().min(1).max(52_428_800) }).strict();
const sponsorFields = {
  company_name: short,
  contact_email: z.string().email().max(320),
  contact_person: z.string().max(200).nullable().optional(),
  contact_phone: z.string().max(80).nullable().optional(),
  address: z.string().max(1_000).nullable().optional(),
  website_url: httpsUrl.nullable().optional(),
  organization_type: z.string().max(100).nullable().optional(),
} as const;
const sponsorChanges = nonEmpty({
  company_name: short.optional(), contact_email: z.string().email().max(320).optional(), contact_person: z.string().max(200).nullable().optional(),
  contact_phone: z.string().max(80).nullable().optional(), address: z.string().max(1_000).nullable().optional(), website_url: httpsUrl.nullable().optional(), organization_type: z.string().max(100).nullable().optional(),
});
const productFields = {
  name: short, description: z.string().max(5_000).nullable().optional(), conditions: long.nullable().optional(),
  default_unit_price_cents: cents.nullable().optional(), currency, billing_interval: billing.default("year"), default_duration_months: z.number().int().min(1).max(1_200).nullable().optional().default(12), sort_order: z.number().int().min(-10_000).max(10_000).default(0),
} as const;
const productChanges = nonEmpty({
  name: short.optional(), description: z.string().max(5_000).nullable().optional(), conditions: long.nullable().optional(),
  default_unit_price_cents: cents.nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/u).optional(), billing_interval: billing.optional(), default_duration_months: z.number().int().min(1).max(1_200).nullable().optional(), is_active: z.boolean().optional(), sort_order: z.number().int().min(-10_000).max(10_000).optional(),
});
const contractFields = {
  label: z.string().max(200).nullable().optional(), conditions: long.nullable().optional(), unit_price_cents: cents.nullable().optional(), currency,
  billing_interval: billing.default("year"), duration_months: z.number().int().min(1).max(1_200).nullable().optional().default(12), contract_file_id: uuid,
  valid_from: instant, valid_until: instant.nullable().optional(), supersedes_version_id: uuid.nullable().optional(), superseded_valid_until: instant.nullable().optional(), note: z.string().max(5_000).nullable().optional(),
} as const;
const contractChanges = nonEmpty({
  label: z.string().max(200).nullable().optional(), conditions: long.nullable().optional(), unit_price_cents: cents.nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
  billing_interval: billing.optional(), duration_months: z.number().int().min(1).max(1_200).nullable().optional(), valid_from: instant.optional(), valid_until: instant.nullable().optional(), supersedes_version_id: uuid.nullable().optional(), note: z.string().max(5_000).nullable().optional(),
});
const assignmentTimes = <T extends z.ZodTypeAny>(schema: T) => schema.refine((value: unknown) => {
  const row = value as { starts_at?: string | null; ends_at?: string | null };
  return !row.starts_at || !row.ends_at || Date.parse(row.starts_at) <= Date.parse(row.ends_at);
}, "Das Enddatum darf nicht vor dem Startdatum liegen.");
const assignmentChanges = nonEmpty({
  sponsorship_product_id: uuid.optional(), quantity: z.number().int().min(1).max(100_000).optional(), unit_price_cents: cents.nullable().optional(), total_price_cents: cents.nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/u).optional(), status: z.enum(["active", "paused", "cancelled", "expired"]).optional(), starts_at: instant.nullable().optional(), ends_at: instant.nullable().optional(), note: z.string().max(5_000).nullable().optional(),
});

export const MARKETING_ASSET_SCHEMA = remoteAsset;
export const K13_ACTION_SCHEMAS: Readonly<Record<K13ActionId, K13ActionSchemaContract>> = Object.freeze({
  "cai.sponsor.01.list": contract(single({ limit: z.number().int().min(1).max(100).default(50) })),
  "cai.sponsor.02.show": contract(single({ sponsor_id: uuid })),
  "cai.sponsor.03.add": contract(single({ ...sponsorFields, department_id: uuid })),
  "cai.sponsor.04.update": contract(union([grouped("update", { sponsor_id: uuid, changes: sponsorChanges }), grouped("move_department", { sponsor_id: uuid, target_department_id: uuid })])),
  "cai.sponsor.05.delete": contract(single({ sponsor_id: uuid })),
  "cai.sponsor.06.logo": contract(single({ sponsor_id: uuid, logo_file_id: uuid })),
  "cai.sponsor.07.product_list": contract(single({ include_inactive: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) })),
  "cai.sponsor.08.product_add": contract(single({ ...productFields, department_id: uuid })),
  "cai.sponsor.09.product_update": contract(union([grouped("update", { product_id: uuid, changes: productChanges }), grouped("move_department", { product_id: uuid, target_department_id: uuid })])),
  "cai.sponsor.10.product_delete": contract(single({ product_id: uuid })),
  "cai.sponsor.11.contract_list": contract(single({ product_id: uuid, limit: z.number().int().min(1).max(100).default(50) })),
  "cai.sponsor.12.contract_add": contract(single({ product_id: uuid, ...contractFields }).refine((value) => !value.valid_until || Date.parse(value.valid_from) <= Date.parse(value.valid_until), "Das Gültigkeitsende darf nicht vor dem Beginn liegen.")),
  "cai.sponsor.13.contract_update": contract(union([grouped("update", { product_id: uuid, contract_version_id: uuid, changes: contractChanges }), grouped("replace_file", { product_id: uuid, contract_version_id: uuid, contract_file_id: uuid })])),
  "cai.sponsor.14.contract_delete": contract(single({ product_id: uuid, contract_version_id: uuid })),
  "cai.sponsor.15.assignment_list": contract(single({ sponsor_id: uuid.optional(), status: z.enum(["active", "paused", "cancelled", "expired"]).optional(), include_deleted: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) })),
  "cai.sponsor.16.assign": contract(assignmentTimes(single({ department_id: uuid, sponsor_id: uuid, product_id: uuid, quantity: z.number().int().min(1).max(100_000).default(1), unit_price_cents: cents.nullable().optional(), total_price_cents: cents.nullable().optional(), currency, starts_at: instant.nullable().optional(), ends_at: instant.nullable().optional(), note: z.string().max(5_000).nullable().optional() }))),
  "cai.sponsor.17.assignment_update": contract(assignmentTimes(single({ assignment_id: uuid, changes: assignmentChanges }))),
  "cai.sponsor.18.cancel": contract(single({ assignment_id: uuid, ends_at: instant.nullable().optional(), cancellation_note: z.string().max(5_000).nullable().optional() })),
  "cai.sponsor.19.doc_list": contract(single({ assignment_id: uuid, limit: z.number().int().min(1).max(100).default(50) })),
  "cai.sponsor.20.doc_upload": contract(single({ assignment_id: uuid, asset: remoteAsset, label: z.string().trim().min(1).max(200).default("contract") })),
  "cai.sponsor.21.responsible_list": contract(single({ sponsor_id: uuid.optional(), member_id: uuid.optional(), limit: z.number().int().min(1).max(100).default(50) })),
  "cai.sponsor.22.responsible_add": contract(single({ department_id: uuid, sponsor_id: uuid, member_id: uuid, role: z.string().trim().min(1).max(50).default("responsible"), is_primary: z.boolean().default(false), note: z.string().max(5_000).nullable().optional() })),
  "cai.sponsor.23.responsible_update": contract(single({ responsible_id: uuid, changes: nonEmpty({ member_id: uuid.optional(), role: z.string().trim().min(1).max(50).optional(), is_primary: z.boolean().optional(), note: z.string().max(5_000).nullable().optional() }) })),
  "cai.sponsor.24.responsible_remove": contract(single({ responsible_id: uuid })),
});
