import { z } from "zod";

import type { JsonValue, RequestContext } from "@comvenio/connector-contracts";

const rawObject = z.object({}).passthrough();
const rawArray = z.array(rawObject);

function object(value: unknown): Record<string, unknown> {
  return rawObject.parse(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(value: unknown, field: string): string {
  const parsed = nullableString(value);
  if (parsed === null) throw new Error(`Die Backendantwort enthält kein gültiges Feld ${field}.`);
  return parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function maskEmail(value: unknown): string | null {
  const email = nullableString(value);
  if (!email) return null;
  const separator = email.lastIndexOf("@");
  if (separator < 1) return null;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const domainParts = domain.split(".");
  const host = domainParts.shift() ?? "";
  const suffix = domainParts.length ? `.${domainParts.join(".")}` : "";
  return `${local[0]}***@${host[0] ?? "*"}***${suffix}`;
}

export function maskPhone(value: unknown): string | null {
  const phone = nullableString(value);
  if (!phone) return null;
  const digits = phone.replace(/\D/gu, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

function departmentLabels(member: Record<string, unknown>): string[] {
  if (Array.isArray(member.department_labels)) {
    return member.department_labels.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
  }
  if (!Array.isArray(member.assignments)) return [];
  return member.assignments.flatMap((assignment) => {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return [];
    const row = assignment as Record<string, unknown>;
    const nested = row.department;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const name = nullableString((nested as Record<string, unknown>).name);
      if (name) return [name];
    }
    const direct = nullableString(row.department_name);
    return direct ? [direct] : [];
  });
}

function statusLabel(member: Record<string, unknown>): string | null {
  const direct = nullableString(member.status_label);
  if (direct) return direct;
  const nested = member.membership_status;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nullableString((nested as Record<string, unknown>).name)
    : null;
}

export function redactMemberListItem(value: unknown): JsonValue {
  const member = object(value);
  const firstName = nullableString(member.first_name) ?? "";
  const lastName = nullableString(member.last_name) ?? "";
  return {
    member_id: requiredString(member.id ?? member.member_id, "id"),
    display_name: `${firstName} ${lastName}`.trim() || "Mitglied",
    status_label: statusLabel(member),
    department_labels: departmentLabels(member),
    email_masked: maskEmail(member.email),
    phone_masked: maskPhone(member.phone_number),
  };
}

export function redactMemberList(
  value: unknown,
  requested: { limit: number; offset: number },
): JsonValue {
  const envelope = Array.isArray(value) ? null : object(value);
  const items = Array.isArray(value) ? rawArray.parse(value) : rawArray.parse(envelope?.items ?? []);
  const total = envelope && typeof envelope.total === "number" && Number.isInteger(envelope.total)
    ? envelope.total
    : null;
  const limit = envelope && typeof envelope.limit === "number" && Number.isInteger(envelope.limit)
    ? envelope.limit
    : requested.limit;
  const offset = envelope && typeof envelope.offset === "number" && Number.isInteger(envelope.offset)
    ? envelope.offset
    : requested.offset;
  return { items: items.map(redactMemberListItem), limit, offset, total };
}

export function redactMemberDetail(value: unknown): JsonValue {
  const member = object(value);
  return {
    member_id: requiredString(member.id ?? member.member_id, "id"),
    first_name: requiredString(member.first_name, "first_name"),
    last_name: requiredString(member.last_name, "last_name"),
    email: nullableString(member.email),
    phone_number: nullableString(member.phone_number),
    birthdate: nullableString(member.birthdate),
    address: nullableString(member.address),
    postal_code: nullableString(member.postal_code),
    city: nullableString(member.city),
    state: nullableString(member.state),
    country: nullableString(member.country),
    joined_at: nullableString(member.joined_at),
    left_at: nullableString(member.left_at),
  };
}

export function redactWhoami(value: unknown, context: RequestContext): JsonValue {
  const user = object(value);
  const firstName = nullableString(user.first_name);
  const lastName = nullableString(user.last_name);
  return {
    subject_id: context.subject_id!,
    club_id: context.club_id!,
    display_name: nullableString(user.full_name)
      ?? ([firstName, lastName].filter((part): part is string => part !== null).join(" ").trim()
        || null),
    email: nullableString(user.email),
  };
}

function pick(record: Record<string, unknown>, keys: readonly string[]): Record<string, JsonValue> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = record[key];
    if (value === undefined) return [];
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [[key, value] as const];
    }
    if (Array.isArray(value) && value.every((entry) =>
      entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) {
      return [[key, value as JsonValue] as const];
    }
    return [];
  }));
}

function pickNested(
  source: Record<string, unknown>,
  key: string,
  keys: readonly string[],
): JsonValue | undefined {
  const value = source[key];
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return pick(value as Record<string, unknown>, keys);
}

function hexRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^[a-z][a-z0-9_]{0,39}$/u.test(key) && typeof entry === "string" && /^#[0-9a-f]{6}$/iu.test(entry)) result[key] = entry;
  }
  return result;
}

function numberRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^[a-z][a-z0-9_]{0,15}$/u.test(key) && typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
  }
  return result;
}

/**
 * Roles with source verein whose font_id is not in the register: web and app
 * show the fallback font there (homepage-generator 18 DC-8).
 */
function missingClubFonts(design: Record<string, JsonValue>): JsonValue[] {
  const tokens = design.tokens;
  const type = tokens && typeof tokens === "object" && !Array.isArray(tokens) ? (tokens as Record<string, JsonValue>).type : undefined;
  if (!type || typeof type !== "object" || Array.isArray(type)) return [];
  const registered = new Set(Array.isArray(design.fonts)
    ? design.fonts.flatMap((font) => (font && typeof font === "object" && !Array.isArray(font) && typeof font.id === "string" ? [font.id] : []))
    : []);
  const hints: JsonValue[] = [];
  for (const role of ["heading", "body"] as const) {
    const entry = (type as Record<string, JsonValue>)[role];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.source === "verein" && typeof entry.font_id === "string" && !registered.has(entry.font_id)) {
      hints.push({ rolle: role, font_id: entry.font_id, hinweis: "Schrift nicht im Register: Web und App zeigen die Rückfallschrift." });
    }
  }
  return hints;
}

/** tokens.type: only the heading/body roles with their four known fields. */
function fontRoles(value: unknown): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, JsonValue> = {};
  for (const role of ["heading", "body"] as const) {
    const entry = (value as Record<string, unknown>)[role];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const picked = pick(entry as Record<string, unknown>, ["family", "source", "font_id", "weight"]);
      // The club-service allows weight null; on a read it means "not set".
      if (picked.weight === null) delete picked.weight;
      result[role] = picked;
    }
  }
  return result;
}

export function redactClubSettings(value: unknown): JsonValue {
  const settings = object(value);
  const result: Record<string, JsonValue> = {};
  if (typeof settings.organization_type === "string" || settings.organization_type === null) {
    result.organization_type = settings.organization_type;
  }
  const sections = [
    ["features", ["enable_public_homepage", "enable_member_directory", "enable_event_registration", "enable_news_comments", "enable_booking_system", "enable_payment_integration", "enable_social_media_integration", "enable_multi_language"]],
    ["homepage_config", ["show_header", "show_footer", "header_style", "footer_content", "navigation_position", "enable_search", "default_tab"]],
    ["privacy_settings", ["public_member_list", "public_events", "public_news", "require_login_for_content", "show_member_count", "show_department_structure"]],
    ["seo_settings", ["meta_title", "meta_description", "meta_keywords", "og_image", "enable_analytics", "analytics_id"]],
    ["notification_settings", ["email_notifications", "push_notifications", "sms_notifications", "notification_frequency", "digest_time"]],
    ["locale_settings", ["default_language", "available_languages", "timezone", "date_format", "time_format"]],
  ] as const;
  for (const [key, keys] of sections) {
    const section = pickNested(settings, key, keys);
    if (section !== undefined) result[key] = section;
  }

  const contact = settings.contact_info;
  if (contact === null) {
    result.contact_info = null;
  } else if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const contactRecord = contact as Record<string, unknown>;
    const safeContact = pick(contactRecord, ["email", "phone", "address", "website"]);
    const social = pickNested(contactRecord, "social_media", ["facebook", "instagram", "twitter", "youtube", "linkedin"]);
    if (social !== undefined) safeContact.social_media = social;
    result.contact_info = safeContact;
  }

  const design = settings.design_settings;
  if (design === null) {
    result.design_settings = null;
  } else if (design && typeof design === "object" && !Array.isArray(design)) {
    const designRecord = design as Record<string, unknown>;
    const safeDesign = pick(designRecord, [
      "homepage_theme", "homepage_template", "primary_color", "secondary_color", "accent_color",
      "logo_url", "favicon_url", "custom_css", "hub_bg_color", "header_bg_color", "header_font_color",
      "content_bg_color", "sidebar_style", "sidebar_color_mode", "sidebar_custom_bg", "sidebar_font_color",
      "nav_auto_hide", "nav_mini_mode", "quicklist_mode", "onepager",
    ]);
    const custom = designRecord.custom_template_config;
    if (custom === null) {
      safeDesign.custom_template_config = null;
    } else if (custom && typeof custom === "object" && !Array.isArray(custom)) {
      const customRecord = custom as Record<string, unknown>;
      const safeCustom = pick(customRecord, ["font_pair", "spacing"]);
      const header = pickNested(customRecord, "public_header", ["layout", "surface", "density", "sticky"]);
      if (header !== undefined) safeCustom.public_header = header;
      safeDesign.custom_template_config = safeCustom;
    }
    const tokens = designRecord.tokens;
    if (tokens === null) {
      safeDesign.tokens = null;
    } else if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
      const tokenRecord = tokens as Record<string, unknown>;
      const safeTokens = pick(tokenRecord, ["spacing_scale", "type_scale", "shadow_level"]);
      // Every palette role is a public colour (the sidebar reads nav/on_nav); keep hex values only.
      const palette = hexRecord(tokenRecord.palette);
      if (palette !== undefined) safeTokens.palette = palette;
      const radius = numberRecord(tokenRecord.radius);
      if (radius !== undefined) safeTokens.radius = radius;
      const type = fontRoles(tokenRecord.type);
      if (type !== undefined) safeTokens.type = type;
      safeDesign.tokens = safeTokens;
    }
    // Club font register (homepage-generator 18): ids, families, formats and
    // licence notes are the club's own design data, no member data.
    if (Array.isArray(designRecord.fonts)) {
      safeDesign.fonts = designRecord.fonts
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
        .slice(0, 2)
        .map((entry) => pick(entry, ["id", "family", "format", "lizenz"]));
    }
    const hinweise = missingClubFonts(safeDesign);
    if (hinweise.length > 0) safeDesign.font_hinweise = hinweise;
    result.design_settings = safeDesign;
  }
  return result;
}

export function redactAssignment(value: unknown): JsonValue {
  const assignment = object(value);
  const nestedRole = assignment.role && typeof assignment.role === "object" && !Array.isArray(assignment.role)
    ? assignment.role as Record<string, unknown>
    : null;
  return {
    id: requiredString(assignment.id, "id"),
    club_id: requiredString(assignment.club_id, "club_id"),
    member_id: requiredString(assignment.member_id, "member_id"),
    role_id: requiredString(assignment.role_id, "role_id"),
    role_name: nullableString(nestedRole?.name),
    scope: requiredString(assignment.scope, "scope"),
    department_id: nullableString(assignment.department_id),
    ...(optionalBoolean(assignment.is_active) === undefined ? {} : { is_active: assignment.is_active as boolean }),
  };
}

export function redactPositionRole(value: unknown): JsonValue {
  const assignment = object(value);
  const nestedRole = assignment.role && typeof assignment.role === "object" && !Array.isArray(assignment.role)
    ? assignment.role as Record<string, unknown>
    : null;
  return {
    id: requiredString(assignment.id, "id"),
    club_id: requiredString(assignment.club_id, "club_id"),
    position_id: requiredString(assignment.position_id, "position_id"),
    role_id: requiredString(assignment.role_id, "role_id"),
    role_name: nullableString(nestedRole?.name),
    department_id: nullableString(assignment.department_id),
    ...(optionalBoolean(assignment.is_active) === undefined ? {} : { is_active: assignment.is_active as boolean }),
  };
}

function permissionEntries(value: unknown): JsonValue[] {
  const record = object(value);
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right)).map(
    ([permission_key, allowed]) => ({ permission_key, allowed: allowed === true }),
  );
}

export function redactPermissionMatrix(value: unknown): JsonValue {
  const result = object(value);
  return {
    role_id: requiredString(result.role_id, "role_id"),
    mode: requiredString(result.mode, "mode"),
    before: permissionEntries(result.before),
    after: permissionEntries(result.after),
    changed: Array.isArray(result.changed)
      ? result.changed.filter((entry): entry is string => typeof entry === "string")
      : [],
    changes: Array.isArray(result.changes)
      ? result.changes.map((entry) => {
          const change = object(entry);
          return {
            permission_key: requiredString(change.permission_key, "permission_key"),
            before: change.before === true,
            after: change.after === true,
          };
        })
      : [],
  };
}
