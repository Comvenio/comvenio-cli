import { z } from "zod";

import type { K7ActionId, K7ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1).max(500);
const shortText = z.string().trim().min(1).max(160);
const optionalText = z.string().trim().max(2_000).nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const color = z.string().regex(/^#[0-9a-f]{6}$/iu);
const emailOrEmpty = z.union([z.string().email().max(320), z.literal("")]);
const urlOrEmpty = z.union([z.string().url().max(2_048), z.literal("")]);

const clubContext = z.object({ club_id: uuid }).strict();
const entityContext = (field: string) => z.object({ club_id: uuid, [field]: uuid }).strict();
const deleted = z.object({ deleted: z.literal(true), id: uuid }).strict();

const clubProfileFields = {
  name: shortText.optional(),
  description: optionalText,
  address: optionalText,
  city: optionalText,
  postal_code: z.string().trim().max(32).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  phone_number: z.string().trim().max(80).nullable().optional(),
  subdomain: z.string().trim().max(63).optional(),
  slug: z.string().trim().max(63).optional(),
  email_address: emailOrEmpty.nullable().optional(),
  website_url: urlOrEmpty.nullable().optional(),
  logo_url: urlOrEmpty.nullable().optional(),
  color_theme_1: color.nullable().optional(),
  color_theme_2: color.nullable().optional(),
  color_theme_3: color.nullable().optional(),
  founded_date: date.nullable().optional(),
  facebook_url: urlOrEmpty.nullable().optional(),
  instagram_url: urlOrEmpty.nullable().optional(),
  twitter_url: urlOrEmpty.nullable().optional(),
  linkedin_url: urlOrEmpty.nullable().optional(),
  youtube_url: urlOrEmpty.nullable().optional(),
  tiktok_url: urlOrEmpty.nullable().optional(),
  default_language: z.string().trim().min(2).max(16).nullable().optional(),
  default_timezone: z.string().trim().min(1).max(80).nullable().optional(),
} as const;

const clubProfilePatch = z.object(clubProfileFields).strict()
  .refine((value) => Object.keys(value).length > 0, "Mindestens ein Profilfeld ist erforderlich.");
const clubOutput = z.object({ id: uuid, ...clubProfileFields }).strip();

const publicHeader = z.object({
  layout: z.enum(["navigation", "brand-left"]).optional(),
  surface: z.enum(["light", "dark", "brand"]).optional(),
  density: z.enum(["compact", "comfortable"]).optional(),
  sticky: z.boolean().optional(),
}).strict();
const designTokens = z.object({
  palette: z.object({
    primary: color.optional(),
    secondary: color.optional(),
    accent: color.optional(),
    background: color.optional(),
    surface: color.optional(),
    text: color.optional(),
  }).strict().optional(),
  radius: z.enum(["none", "small", "medium", "large", "pill"]).optional(),
  spacing_scale: z.enum(["compact", "normal", "spacious"]).optional(),
  type_scale: z.enum(["compact", "normal", "large"]).optional(),
  shadow_level: z.enum(["none", "subtle", "medium", "strong"]).optional(),
}).strict();
const designSettings = z.object({
  homepage_theme: z.enum([
    "modern", "sport", "elegant", "vibrant", "classic", "minimal", "bold",
    "playful", "glass", "neomorphic", "retro", "neon", "nature", "corporate",
  ]).optional(),
  homepage_template: z.enum([
    "elegance", "sport", "community", "minimal", "festlich", "modern", "classic", "flex",
  ]).nullable().optional(),
  primary_color: color.nullable().optional(),
  secondary_color: color.nullable().optional(),
  accent_color: color.nullable().optional(),
  logo_url: urlOrEmpty.nullable().optional(),
  favicon_url: urlOrEmpty.nullable().optional(),
  custom_css: z.string().max(50_000).nullable().optional(),
  hub_bg_color: color.nullable().optional(),
  header_bg_color: color.nullable().optional(),
  header_font_color: color.nullable().optional(),
  content_bg_color: color.nullable().optional(),
  sidebar_style: z.enum(["slide", "fixed"]).optional(),
  sidebar_color_mode: z.enum(["match", "custom"]).optional(),
  sidebar_custom_bg: color.nullable().optional(),
  sidebar_font_color: color.nullable().optional(),
  nav_auto_hide: z.boolean().optional(),
  nav_mini_mode: z.boolean().optional(),
  quicklist_mode: z.enum(["visible", "hidden"]).nullable().optional(),
  onepager: z.boolean().optional(),
  custom_template_config: z.object({
    font_pair: z.enum(["default", "editorial", "sporty", "friendly", "corporate"]).optional(),
    spacing: z.enum(["compact", "normal", "spacious"]).optional(),
    public_header: publicHeader.nullable().optional(),
  }).strict().nullable().optional(),
  tokens: designTokens.nullable().optional(),
}).strict();

const features = z.object({
  enable_public_homepage: z.boolean().optional(),
  enable_member_directory: z.boolean().optional(),
  enable_event_registration: z.boolean().optional(),
  enable_news_comments: z.boolean().optional(),
  enable_booking_system: z.boolean().optional(),
  enable_payment_integration: z.boolean().optional(),
  enable_social_media_integration: z.boolean().optional(),
  enable_multi_language: z.boolean().optional(),
}).strict();
const homepageConfig = z.object({
  show_header: z.boolean().optional(),
  show_footer: z.boolean().optional(),
  header_style: z.string().trim().max(80).optional(),
  footer_content: z.string().max(5_000).nullable().optional(),
  navigation_position: z.enum(["top", "side"]).optional(),
  enable_search: z.boolean().optional(),
  default_tab: z.string().trim().max(80).optional(),
}).strict();
const privacySettings = z.object({
  public_member_list: z.boolean().optional(),
  public_events: z.boolean().optional(),
  public_news: z.boolean().optional(),
  require_login_for_content: z.boolean().optional(),
  show_member_count: z.boolean().optional(),
  show_department_structure: z.boolean().optional(),
}).strict();
const socialMedia = z.object({
  facebook: urlOrEmpty.nullable().optional(),
  instagram: urlOrEmpty.nullable().optional(),
  twitter: urlOrEmpty.nullable().optional(),
  youtube: urlOrEmpty.nullable().optional(),
  linkedin: urlOrEmpty.nullable().optional(),
}).strict();
const contactInfo = z.object({
  email: emailOrEmpty.nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  website: urlOrEmpty.nullable().optional(),
  social_media: socialMedia.optional(),
}).strict();
const seoSettings = z.object({
  meta_title: z.string().max(180).nullable().optional(),
  meta_description: z.string().max(500).nullable().optional(),
  meta_keywords: z.string().max(500).nullable().optional(),
  og_image: urlOrEmpty.nullable().optional(),
  enable_analytics: z.boolean().optional(),
  analytics_id: z.string().max(160).nullable().optional(),
}).strict();
const notificationSettings = z.object({
  email_notifications: z.boolean().optional(),
  push_notifications: z.boolean().optional(),
  sms_notifications: z.boolean().optional(),
  notification_frequency: z.enum(["instant", "daily", "weekly"]).optional(),
  digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).optional(),
}).strict();
const localeSettings = z.object({
  default_language: z.string().trim().min(2).max(16).optional(),
  available_languages: z.array(z.string().trim().min(2).max(16)).max(20).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  date_format: z.string().trim().max(32).optional(),
  time_format: z.string().trim().max(32).optional(),
}).strict();
const settingsPayload = z.object({
  organization_type: z.string().trim().max(80).nullable().optional(),
  design_settings: designSettings.nullable().optional(),
  features: features.nullable().optional(),
  homepage_config: homepageConfig.nullable().optional(),
  privacy_settings: privacySettings.nullable().optional(),
  contact_info: contactInfo.nullable().optional(),
  seo_settings: seoSettings.nullable().optional(),
  notification_settings: notificationSettings.nullable().optional(),
  locale_settings: localeSettings.nullable().optional(),
}).strict();

const departmentPatch = z.object({
  name: shortText.optional(),
  description: optionalText,
  slug: z.string().trim().max(80).nullable().optional(),
  color_theme_1: color.nullable().optional(),
  color_theme_2: color.nullable().optional(),
  color_theme_3: color.nullable().optional(),
  responsible_member_id: uuid.nullable().optional(),
  parent_department_id: uuid.nullable().optional(),
}).strict();
const departmentCreate = departmentPatch.extend({
  name: shortText,
  is_default: z.boolean().optional(),
}).strict();
const departmentOutput: z.ZodType = z.lazy(() => z.object({
  id: uuid,
  club_id: uuid,
  name: z.string(),
  description: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  color_theme_1: z.string().nullable().optional(),
  color_theme_2: z.string().nullable().optional(),
  color_theme_3: z.string().nullable().optional(),
  parent_department_id: uuid.nullable().optional(),
  responsible_member_id: uuid.nullable().optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  children: z.array(departmentOutput).optional(),
}).strip());

const memberFields = {
  first_name: shortText,
  last_name: shortText,
  email: z.string().email().max(320).nullable().optional(),
  phone_number: z.string().trim().max(80).nullable().optional(),
  birthdate: date.nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  postal_code: z.string().trim().max(32).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  joined_at: date.nullable().optional(),
  left_at: date.nullable().optional(),
} as const;
const memberCreate = z.object({
  ...memberFields,
  is_active: z.boolean().optional(),
  user_id: uuid.nullable().optional(),
  membership_status_id: uuid.nullable().optional(),
  family_id: uuid.nullable().optional(),
}).strict();
const memberUpdate = z.object({
  ...Object.fromEntries(Object.entries(memberFields).map(([key, schema]) => [key, schema.optional()])),
  is_active: z.boolean().optional(),
  user_id: uuid.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens ein Mitgliedsfeld ist erforderlich.");
const memberListItem = z.object({
  member_id: uuid,
  display_name: z.string(),
  status_label: z.string().nullable(),
  department_labels: z.array(z.string()),
  email_masked: z.string().nullable(),
  phone_masked: z.string().nullable(),
}).strict();
const memberDetail = z.object({ member_id: uuid, ...memberFields }).strict();

const familyCreate = z.object({ name: shortText, notes: optionalText, responsible_member_id: uuid }).strict();
const familyPatch = z.object({
  name: shortText.optional(), notes: optionalText, responsible_member_id: uuid.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens ein Familienfeld ist erforderlich.");
const familyOutput = z.object({
  id: uuid, club_id: uuid, name: z.string(), notes: z.string().nullable().optional(), responsible_member_id: uuid,
}).strip();

const statusCreate = z.object({
  name: shortText,
  description: optionalText,
  is_discount_eligible: z.boolean().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
}).strict();
const statusPatch = statusCreate.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Mindestens ein Statusfeld ist erforderlich.",
);
const statusOutput = z.object({
  id: uuid,
  club_id: uuid,
  name: z.string(),
  description: z.string().nullable().optional(),
  is_discount_eligible: z.boolean(),
  priority: z.number().int(),
}).strip();

const periodCreate = z.object({
  member_id: uuid,
  joined_at: date,
  left_at: date.nullable().optional(),
  reason: optionalText,
  note: optionalText,
}).strict();
const periodPatch = periodCreate.omit({ member_id: true }).partial().refine(
  (value) => Object.keys(value).length > 0,
  "Mindestens ein Zeitraumfeld ist erforderlich.",
);
const periodOutput = z.object({
  id: uuid,
  club_id: uuid,
  member_id: uuid,
  joined_at: date,
  left_at: date.nullable().optional(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
}).strip();

const sportType = z.enum(["FOOTBALL", "HANDBALL", "BASKETBALL", "VOLLEYBALL", "TENNIS", "TABLE_TENNIS", "OTHER"]);
const teamGender = z.enum(["MALE", "FEMALE", "MIXED"]);
const teamFields = {
  department_id: uuid,
  name: shortText,
  sport_type: sportType,
  age_group: z.string().trim().max(80).nullable().optional(),
  gender: teamGender.optional(),
  description: optionalText,
  season: z.string().trim().max(80).nullable().optional(),
  external_provider_id: uuid.nullable().optional(),
  external_team_key: z.string().trim().max(250).nullable().optional(),
  home_location: z.string().trim().max(500).nullable().optional(),
  logo_url: z.string().url().max(2_048).nullable().optional(),
  required_resource_count: z.number().int().min(1).max(100).optional(),
  buffer_before_minutes: z.number().int().min(0).max(1_440).optional(),
  buffer_after_minutes: z.number().int().min(0).max(1_440).optional(),
} as const;
const teamCreate = z.object(teamFields).strict();
const teamPatch = teamCreate.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Mindestens ein Teamfeld ist erforderlich.",
);
const teamOutput = z.object({
  id: uuid,
  club_id: uuid,
  ...teamFields,
  gender: teamGender,
  required_resource_count: z.number().int(),
  buffer_before_minutes: z.number().int(),
  buffer_after_minutes: z.number().int(),
  is_active: z.boolean(),
}).strip();
const teamMemberFields = {
  role: z.enum(["PLAYER", "CAPTAIN", "COACH", "ASSISTANT_COACH", "MANAGER"]).optional(),
  jersey_number: z.number().int().min(0).max(999).nullable().optional(),
  position: z.string().trim().max(160).nullable().optional(),
} as const;
const teamMemberOutput = z.object({
  id: uuid, team_id: uuid, club_id: uuid, member_id: uuid,
  role: z.string(), jersey_number: z.number().int().nullable().optional(), position: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
}).strip();
const teamMemberOperation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list"), club_id: uuid, team_id: uuid }).strict(),
  z.object({ operation: z.literal("add"), club_id: uuid, team_id: uuid, member_id: uuid, ...teamMemberFields }).strict(),
  z.object({ operation: z.literal("update"), club_id: uuid, team_id: uuid, member_id: uuid, changes: z.object(teamMemberFields).strict() }).strict(),
  z.object({ operation: z.literal("remove"), club_id: uuid, team_id: uuid, member_id: uuid }).strict(),
]);
const teamMemberResult = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list"), items: z.array(teamMemberOutput) }).strict(),
  z.object({ operation: z.literal("add"), item: teamMemberOutput }).strict(),
  z.object({ operation: z.literal("update"), item: teamMemberOutput }).strict(),
  z.object({ operation: z.literal("remove"), deleted: z.literal(true), team_id: uuid, member_id: uuid }).strict(),
]);
const resourceFields = {
  priority: z.number().int().min(1).max(10_000).optional(),
  booking_duration_minutes: z.number().int().min(1).max(10_080).optional(),
  notes: optionalText,
} as const;
const resourceOutput = z.object({
  id: uuid, team_id: uuid, club_id: uuid, object_id: uuid,
  priority: z.number().int(), booking_duration_minutes: z.number().int(), notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
}).strip();
const resourceOperation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list"), club_id: uuid, team_id: uuid }).strict(),
  z.object({ operation: z.literal("add"), club_id: uuid, team_id: uuid, object_id: uuid, ...resourceFields }).strict(),
  z.object({ operation: z.literal("update"), club_id: uuid, team_id: uuid, priority_id: uuid, changes: z.object(resourceFields).strict() }).strict(),
  z.object({ operation: z.literal("remove"), club_id: uuid, team_id: uuid, priority_id: uuid }).strict(),
]);
const resourceResult = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list"), items: z.array(resourceOutput) }).strict(),
  z.object({ operation: z.literal("add"), item: resourceOutput }).strict(),
  z.object({ operation: z.literal("update"), item: resourceOutput }).strict(),
  z.object({ operation: z.literal("remove"), deleted: z.literal(true), id: uuid }).strict(),
]);

// ── Saisonale Mannschaften (K9) — `comvenio teams` mirror ──────────────
// Output shapes mirror the member-/event-service Read schemas 1:1 with the
// CLI --json payloads (Lastenheft 09 §1.3: identical return schemas).
const isoDateTime = z.string().min(1).max(64);
const seasonStatus = z.enum(["ENTWURF", "AKTIV", "ABGESCHLOSSEN"]);
const seasonVisibility = z.enum(["PUBLIC", "MEMBERS"]);
const seasonRole = z.enum(["PLAYER", "CAPTAIN", "COACH", "ASSISTANT_COACH", "MANAGER"]);
const seasonMemberStatus = z.enum(["ACTIVE", "INACTIVE", "LEFT"]);
const competitionType = z.enum(["LEAGUE", "CUP", "FRIENDLY", "TOURNAMENT", "OTHER"]);

const seasonalTeamFields = {
  department_id: uuid,
  name: shortText,
  sport_type: sportType,
  category_id: uuid.nullable().optional(),
  age_group: z.string().trim().max(80).nullable().optional(),
  gender: teamGender.optional(),
  description: optionalText,
  home_location: z.string().trim().max(500).nullable().optional(),
} as const;
const seasonalTeamCreate = z.object(seasonalTeamFields).strict();
const seasonalTeamPatch = seasonalTeamCreate.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Mindestens ein Teamfeld ist erforderlich.",
);
const seasonalTeamOutput = z.object({
  id: uuid,
  club_id: uuid,
  department_id: uuid,
  name: z.string(),
  sport_type: z.string(),
  category_id: uuid.nullable().optional(),
  category_name_snapshot: z.string().nullable().optional(),
  age_group: z.string().nullable().optional(),
  gender: z.string().optional(),
  description: z.string().nullable().optional(),
  home_location: z.string().nullable().optional(),
  archived_at: isoDateTime.nullable().optional(),
  is_active: z.boolean().optional(),
}).strip();

const seasonPatchFields = {
  name: shortText.optional(),
  starts_on: date.nullable().optional(),
  ends_on: date.nullable().optional(),
  default_visibility: seasonVisibility.optional(),
} as const;
const seasonCreate = z.object({ ...seasonPatchFields, name: shortText }).strict();
const seasonOutput = z.object({
  id: uuid,
  team_id: uuid,
  club_id: uuid,
  name: z.string(),
  starts_on: date.nullable().optional(),
  ends_on: date.nullable().optional(),
  status: seasonStatus,
  default_visibility: seasonVisibility,
  is_active: z.boolean().optional(),
}).strip();

const rosterEntryFields = {
  role: seasonRole.optional(),
  status: seasonMemberStatus.optional(),
  jersey_number: z.number().int().min(0).max(999).nullable().optional(),
  position: z.string().trim().max(160).nullable().optional(),
  is_primary_team: z.boolean().optional(),
} as const;
const rosterEntryOutput = z.object({
  id: uuid,
  team_season_id: uuid,
  member_id: uuid,
  role: z.string(),
  status: z.string(),
  jersey_number: z.number().int().nullable().optional(),
  position: z.string().nullable().optional(),
  joined_at: isoDateTime.nullable().optional(),
  left_at: isoDateTime.nullable().optional(),
  is_primary_team: z.boolean(),
  carried_over_from_season_id: uuid.nullable().optional(),
}).strip();
const rosterPreviewEntryOutput = z.object({
  member_id: uuid,
  role: z.string(),
  status: z.string(),
  jersey_number: z.number().int().nullable().optional(),
  position: z.string().nullable().optional(),
  already_in_target: z.boolean(),
}).strip();

const competitionFields = {
  name: shortText,
  type: competitionType.optional(),
  association: z.string().trim().max(255).nullable().optional(),
  external_label: z.string().trim().max(255).nullable().optional(),
  is_primary: z.boolean().optional(),
  visibility: seasonVisibility.optional(),
} as const;
const competitionCreate = z.object(competitionFields).strict();
const competitionPatch = competitionCreate.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Mindestens ein Wettbewerbsfeld ist erforderlich.",
);
const competitionOutput = z.object({
  id: uuid,
  team_season_id: uuid,
  name: z.string(),
  type: z.string(),
  association: z.string().nullable().optional(),
  external_label: z.string().nullable().optional(),
  is_primary: z.boolean(),
  visibility: z.string(),
  is_active: z.boolean().optional(),
}).strip();

const syncRunOutput = z.object({
  id: uuid,
  subscription_id: uuid,
  trigger: z.string(),
  status: z.string(),
  created: z.number().int(),
  updated: z.number().int(),
  cancelled: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  clarifications: z.number().int(),
  started_at: isoDateTime.nullable().optional(),
  finished_at: isoDateTime.nullable().optional(),
  error: z.string().nullable().optional(),
}).strip();
// AK-N-02: the backend only ever returns the masked source URL.
const icalSubscriptionOutput = z.object({
  id: uuid,
  team_season_id: uuid,
  masked_url: z.string(),
  status: z.string(),
  last_success_at: isoDateTime.nullable().optional(),
  last_error: z.string().nullable().optional(),
  last_error_at: isoDateTime.nullable().optional(),
  next_sync_at: isoDateTime.nullable().optional(),
  latest_run: syncRunOutput.nullable().optional(),
}).strip();
const activationPreviewOutput = z.object({
  token: z.string(),
  expires_at: isoDateTime,
  entries: z.array(z.object({
    external_id: z.string(),
    starts_at: isoDateTime.nullable().optional(),
    ends_at: isoDateTime.nullable().optional(),
    title: z.string().nullable().optional(),
    mapping: z.string().nullable().optional(),
  }).strip()),
  warnings: z.array(z.string()),
}).strip();
const clarificationOutput = z.object({
  id: uuid,
  team_season_id: uuid,
  type: z.string(),
  status: z.string(),
  title: z.string(),
  reason: z.string(),
}).strip();
const clarificationResolution = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UNKNOWN_COMPETITION"), action: z.enum(["CREATE_COMPETITION", "DISMISS"]) }).strict(),
  z.object({ type: z.literal("AMBIGUOUS_HOME_ROLE"), action: z.enum(["CONFIRM_HOME", "CONFIRM_AWAY"]), trigger_resource_reconcile: z.boolean() }).strict(),
  z.object({ type: z.literal("POSSIBLE_DUPLICATE"), action: z.enum(["KEEP_EXISTING", "KEEP_INCOMING", "DISMISS"]) }).strict(),
  z.object({ type: z.literal("RESOURCE_CONFLICT"), action: z.enum(["KEEP_CURRENT", "REASSIGN", "DISMISS"]) }).strict(),
]);
const clarificationResolveOutput = z.object({
  clarification: clarificationOutput,
  resource_reconcile_triggered: z.boolean().optional(),
}).strip();

const roleOutput = z.object({
  id: uuid,
  club_id: uuid,
  name: z.string(),
  description: z.string().nullable().optional(),
  is_protected: z.boolean(),
  is_active: z.boolean().optional(),
}).strip();
const permissionOutput = z.object({ permission_key: z.string(), allowed: z.boolean() }).strip();
const permissionDefinitionOutput = z.object({ key: z.string(), description: z.string(), module: z.string() }).strip();
const permissionValue = z.object({ permission_key: nonEmpty, allowed: z.boolean() }).strict();
const permissionMatrixOutput = z.object({
  role_id: uuid,
  mode: z.enum(["patch", "replace"]),
  before: z.array(permissionValue),
  after: z.array(permissionValue),
  changed: z.array(z.string()),
  changes: z.array(z.object({ permission_key: z.string(), before: z.boolean(), after: z.boolean() }).strict()),
}).strict();
const assignmentOutput = z.object({
  id: uuid,
  club_id: uuid,
  member_id: uuid,
  role_id: uuid,
  role_name: z.string().nullable(),
  scope: z.enum(["club", "department"]),
  department_id: uuid.nullable(),
  is_active: z.boolean().optional(),
}).strict();
const positionRoleOutput = z.object({
  id: uuid,
  club_id: uuid,
  position_id: uuid,
  role_id: uuid,
  role_name: z.string().nullable(),
  department_id: uuid.nullable(),
  is_active: z.boolean().optional(),
}).strict();

const contract = (input: z.ZodType, output: z.ZodType): K7ActionSchemaContract => ({ input, output });

export const K7_ACTION_SCHEMAS: Readonly<Record<K7ActionId, K7ActionSchemaContract>> = Object.freeze({
  "cai.whoami.01.whoami": contract(clubContext, z.object({ subject_id: uuid, club_id: uuid, display_name: z.string().nullable(), email: z.string().email().nullable() }).strict()),
  "cai.club.01.info": contract(clubContext, clubOutput),
  "cai.club.02.update": contract(z.object({ club_id: uuid, changes: clubProfilePatch }).strict(), clubOutput),
  "cai.club.03.settings": contract(clubContext, settingsPayload),
  "cai.club.04.settings_update": contract(z.object({ club_id: uuid, settings: settingsPayload.refine((value) => Object.keys(value).length > 0) }).strict(), settingsPayload),
  "cai.club.05.design": contract(z.object({ club_id: uuid, design_settings: designSettings.refine((value) => Object.keys(value).length > 0) }).strict(), settingsPayload),
  "cai.club.06.department_list": contract(z.object({ club_id: uuid, tree: z.boolean().optional() }).strict(), z.array(departmentOutput)),
  "cai.club.07.department_show": contract(entityContext("department_id"), departmentOutput),
  "cai.club.08.department_add": contract(z.object({ club_id: uuid, department: departmentCreate }).strict(), departmentOutput),
  "cai.club.09.department_update": contract(z.object({ club_id: uuid, department_id: uuid, changes: departmentPatch.refine((value) => Object.keys(value).length > 0) }).strict(), departmentOutput),
  "cai.club.10.department_delete": contract(entityContext("department_id"), deleted),

  "cai.member.01.list": contract(z.object({ club_id: uuid, limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }).strict(), z.object({ items: z.array(memberListItem), limit: z.number().int(), offset: z.number().int(), total: z.number().int().nullable() }).strict()),
  "cai.member.02.show": contract(entityContext("member_id"), memberDetail),
  "cai.member.03.add": contract(z.object({ club_id: uuid, member: memberCreate }).strict(), memberListItem),
  "cai.member.04.update": contract(z.object({ club_id: uuid, member_id: uuid, changes: memberUpdate }).strict(), memberListItem),
  "cai.member.05.remove": contract(entityContext("member_id"), deleted),
  "cai.member.06.import": contract(z.object({ club_id: uuid, file_id: uuid }).strict(), z.object({ job_id: uuid, status: z.enum(["queued", "running"]) }).strict()),
  "cai.member.07.family_list": contract(clubContext, z.array(familyOutput)),
  "cai.member.08.family_show": contract(entityContext("family_id"), familyOutput),
  "cai.member.09.family_add": contract(z.object({ club_id: uuid, family: familyCreate }).strict(), familyOutput),
  "cai.member.10.family_update": contract(z.object({ club_id: uuid, family_id: uuid, changes: familyPatch }).strict(), familyOutput),
  "cai.member.11.family_delete": contract(entityContext("family_id"), deleted),
  "cai.member.12.status_list": contract(clubContext, z.array(statusOutput)),
  "cai.member.13.status_show": contract(entityContext("status_id"), statusOutput),
  "cai.member.14.status_add": contract(z.object({ club_id: uuid, status: statusCreate }).strict(), statusOutput),
  "cai.member.15.status_update": contract(z.object({ club_id: uuid, status_id: uuid, changes: statusPatch }).strict(), statusOutput),
  "cai.member.16.status_delete": contract(entityContext("status_id"), deleted),
  "cai.member.17.period_list": contract(entityContext("member_id"), z.array(periodOutput)),
  "cai.member.18.period_show": contract(entityContext("period_id"), periodOutput),
  "cai.member.19.period_add": contract(z.object({ club_id: uuid, period: periodCreate }).strict(), periodOutput),
  "cai.member.20.period_update": contract(z.object({ club_id: uuid, period_id: uuid, changes: periodPatch }).strict(), periodOutput),
  "cai.member.21.period_delete": contract(entityContext("period_id"), deleted),

  "cai.team.01.list": contract(clubContext, z.array(teamOutput)),
  "cai.team.02.show": contract(entityContext("team_id"), teamOutput),
  "cai.team.03.create": contract(z.object({ club_id: uuid, team: teamCreate }).strict(), teamOutput),
  "cai.team.04.update": contract(z.object({ club_id: uuid, team_id: uuid, changes: teamPatch }).strict(), teamOutput),
  "cai.team.05.delete": contract(entityContext("team_id"), deleted),
  "cai.team.06.member_list_add_update_remove": contract(teamMemberOperation, teamMemberResult),
  "cai.team.07.resource_list_add_update_remove": contract(resourceOperation, resourceResult),

  "cai.teams.01.list": contract(
    z.object({ club_id: uuid, department_id: uuid.optional(), include_descendants: z.boolean().optional() }).strict(),
    z.array(seasonalTeamOutput),
  ),
  "cai.teams.02.show": contract(entityContext("team_id"), seasonalTeamOutput),
  "cai.teams.03.create": contract(z.object({ club_id: uuid, team: seasonalTeamCreate }).strict(), seasonalTeamOutput),
  "cai.teams.04.update": contract(z.object({ club_id: uuid, team_id: uuid, changes: seasonalTeamPatch }).strict(), seasonalTeamOutput),
  "cai.teams.05.archive": contract(entityContext("team_id"), seasonalTeamOutput),
  "cai.teams.06.season_list": contract(entityContext("team_id"), z.array(seasonOutput)),
  "cai.teams.07.season_create": contract(z.object({ club_id: uuid, team_id: uuid, season: seasonCreate }).strict(), seasonOutput),
  "cai.teams.08.season_correct": contract(
    z.object({
      club_id: uuid,
      team_season_id: uuid,
      reason: z.string().trim().min(5).max(500),
      patch: z.object(seasonPatchFields).strict().refine((value) => Object.keys(value).length > 0, "Mindestens ein Korrekturfeld ist erforderlich."),
    }).strict(),
    seasonOutput,
  ),
  "cai.teams.09.season_activate": contract(entityContext("team_season_id"), seasonOutput),
  "cai.teams.10.season_complete": contract(entityContext("team_season_id"), seasonOutput),
  "cai.teams.11.roster_list": contract(entityContext("team_season_id"), z.array(rosterEntryOutput)),
  "cai.teams.12.roster_add": contract(
    z.object({ club_id: uuid, team_season_id: uuid, member_id: uuid, ...rosterEntryFields }).strict(),
    rosterEntryOutput,
  ),
  "cai.teams.13.roster_update": contract(
    z.object({
      club_id: uuid,
      roster_id: uuid,
      changes: z.object(rosterEntryFields).strict().refine((value) => Object.keys(value).length > 0, "Mindestens ein Kaderfeld ist erforderlich."),
    }).strict(),
    rosterEntryOutput,
  ),
  "cai.teams.14.roster_remove": contract(entityContext("roster_id"), z.object({ removed: z.literal(true), roster_id: uuid }).strict()),
  "cai.teams.15.roster_carry_over_preview": contract(
    z.object({ club_id: uuid, team_season_id: uuid, source_season_id: uuid }).strict(),
    z.array(rosterPreviewEntryOutput),
  ),
  "cai.teams.16.roster_carry_over": contract(
    z.object({ club_id: uuid, team_season_id: uuid, source_season_id: uuid, member_ids: z.array(uuid).min(1) }).strict(),
    z.array(rosterEntryOutput),
  ),
  "cai.teams.17.competition_list": contract(entityContext("team_season_id"), z.array(competitionOutput)),
  "cai.teams.18.competition_create": contract(
    z.object({ club_id: uuid, team_season_id: uuid, competition: competitionCreate }).strict(),
    competitionOutput,
  ),
  "cai.teams.19.competition_update": contract(
    z.object({ club_id: uuid, competition_id: uuid, changes: competitionPatch }).strict(),
    competitionOutput,
  ),
  "cai.teams.20.competition_delete": contract(entityContext("competition_id"), z.object({ deleted: z.literal(true), competition_id: uuid }).strict()),
  "cai.teams.21.ical_list": contract(entityContext("team_season_id"), z.array(icalSubscriptionOutput)),
  "cai.teams.22.ical_create": contract(
    z.object({ club_id: uuid, team_season_id: uuid, url: z.string().url().max(2_048) }).strict(),
    icalSubscriptionOutput,
  ),
  "cai.teams.23.ical_preview": contract(entityContext("subscription_id"), activationPreviewOutput),
  "cai.teams.24.ical_activate": contract(
    z.object({
      club_id: uuid,
      subscription_id: uuid,
      preview_token: z.string().min(1).max(500),
      mappings: z.record(z.string(), z.string()).optional(),
    }).strict(),
    icalSubscriptionOutput,
  ),
  "cai.teams.25.ical_deactivate": contract(entityContext("subscription_id"), icalSubscriptionOutput),
  "cai.teams.26.sync_now": contract(entityContext("subscription_id"), syncRunOutput),
  "cai.teams.27.sync_runs": contract(
    z.object({
      club_id: uuid,
      subscription_id: uuid,
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).strict(),
    z.array(syncRunOutput),
  ),
  "cai.teams.28.clarification_list": contract(entityContext("team_season_id"), z.array(clarificationOutput)),
  "cai.teams.29.clarification_resolve": contract(
    z.object({ club_id: uuid, clarification_id: uuid, resolution: clarificationResolution }).strict(),
    clarificationResolveOutput,
  ),

  "cai.role.01.list": contract(clubContext, z.array(roleOutput)),
  "cai.role.02.show": contract(entityContext("role_id"), roleOutput),
  "cai.role.03.create": contract(z.object({ club_id: uuid, role: z.object({ name: shortText, description: optionalText }).strict() }).strict(), roleOutput),
  "cai.role.04.update": contract(z.object({ club_id: uuid, role_id: uuid, changes: z.object({ name: shortText.optional(), description: optionalText }).strict().refine((value) => Object.keys(value).length > 0) }).strict(), roleOutput),
  "cai.role.05.delete": contract(entityContext("role_id"), deleted),
  "cai.role.06.permission_defs": contract(clubContext, z.array(permissionDefinitionOutput)),
  "cai.role.07.permission_set": contract(z.object({ club_id: uuid, role_id: uuid, permission_key: nonEmpty, allowed: z.boolean() }).strict(), permissionMatrixOutput),
  "cai.role.08.permissions_show_apply": contract(z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("show"), club_id: uuid, role_id: uuid }).strict(),
    z.object({ operation: z.literal("apply"), club_id: uuid, role_id: uuid, values: z.array(permissionValue).min(1), replace: z.boolean().default(false) }).strict(),
  ]), z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("show"), permissions: z.array(permissionOutput) }).strict(),
    z.object({ operation: z.literal("apply"), result: permissionMatrixOutput }).strict(),
  ])),
  "cai.role.09.assign": contract(z.object({ club_id: uuid, member_id: uuid, role_id: uuid, scope: z.enum(["club", "department"]), department_id: uuid.nullable().optional() }).strict().superRefine((value, ctx) => {
    if (value.scope === "department" && !value.department_id) ctx.addIssue({ code: "custom", message: "department_id ist erforderlich." });
    if (value.scope === "club" && value.department_id) ctx.addIssue({ code: "custom", message: "department_id ist bei Club-Scope nicht erlaubt." });
  }), assignmentOutput),
  "cai.role.10.unassign": contract(entityContext("assignment_id"), deleted),
  "cai.role.11.assignments": contract(z.object({ club_id: uuid, selector: z.discriminatedUnion("type", [
    z.object({ type: z.literal("club") }).strict(),
    z.object({ type: z.literal("role"), role_id: uuid }).strict(),
    z.object({ type: z.literal("member"), member_id: uuid }).strict(),
    z.object({ type: z.literal("department"), department_id: uuid }).strict(),
  ]) }).strict(), z.array(assignmentOutput)),
  "cai.role.12.position_link": contract(z.object({ club_id: uuid, position_id: uuid, role_id: uuid, department_id: uuid.nullable().optional() }).strict(), positionRoleOutput),
  "cai.role.13.position_unlink": contract(entityContext("assignment_id"), deleted),
  "cai.role.14.position_list": contract(entityContext("position_id"), z.array(positionRoleOutput)),
  "cai.role.15.effective": contract(z.object({ club_id: uuid, department_id: uuid.optional() }).strict(), z.object({ club_id: uuid, department_id: uuid.nullable(), permissions: z.array(permissionOutput) }).strict()),
});
