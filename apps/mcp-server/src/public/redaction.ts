import type { JsonValue, UUID } from "@comvenio/connector-contracts";

import { runtimeError } from "../http/errors.ts";
import { PublicAccessPolicy } from "./policy.ts";
import { PUBLIC_OUTPUT_SCHEMAS } from "./schemas.ts";
import type { PublicResolverAlias } from "./types.ts";

type RecordValue = Record<string, unknown>;

const CLUB_SCOPED_ALIASES = new Set<PublicResolverAlias>([
  "public_club_profile",
  "public_club_home",
  "public_club_legal",
  "public_events",
  "public_training",
  "public_news",
  "public_department_news",
  "public_menu",
  "public_sponsors",
]);

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : string(value);
}

function uuid(value: unknown): string | null {
  const candidate = string(value);
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)
    ? candidate
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function newsRecord(value: unknown, expectedClubId?: UUID): JsonValue | null {
  const raw = object(value);
  if (!raw || raw.visibility_scope !== "public" || raw.is_draft !== false || !raw.published_at
    || (expectedClubId && raw.club_id !== expectedClubId)) return null;
  const id = uuid(raw.id);
  const title = string(raw.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    summary: nullableString(raw.teaser) ?? "",
    sanitized_html: null,
    hero_url: null,
    published_at: string(raw.published_at) ?? "",
    author_display_name: nullableString(raw.author_display_name ?? raw.author_name),
  };
}

function eventRecord(value: unknown, expectedClubId?: UUID): JsonValue | null {
  const raw = object(value);
  if (!raw || raw.visibility_scope !== "public" || raw.status !== "confirmed"
    || (expectedClubId && raw.club_id !== expectedClubId)) return null;
  const id = uuid(raw.id);
  const title = string(raw.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    summary: nullableString(raw.summary),
    start: nullableString(raw.start ?? raw.start_time),
    end: nullableString(raw.end ?? raw.end_time),
    timezone: string(raw.timezone) ?? "Europe/Berlin",
    location: nullableString(raw.location),
    is_public: true,
    cover_url: nullableString(raw.cover_url),
  };
}

function menuItem(value: unknown): JsonValue | null {
  const raw = object(value);
  const recipe = object(raw?.recipe);
  const id = uuid(raw?.id);
  const name = string(raw?.name);
  if (!raw || !id || !name) return null;
  return {
    id,
    name,
    description: nullableString(raw.description ?? recipe?.description),
    price: number(raw.price ?? raw.selling_price),
    category: nullableString(raw.category ?? recipe?.category),
    type: nullableString(raw.type_of_recipe ?? recipe?.type_of_recipe),
    is_available: raw.is_available === undefined ? raw.is_active !== false : raw.is_available === true,
  };
}

function menuRecord(value: unknown, expectedClubId?: UUID): JsonValue | null {
  const raw = object(value);
  if (!raw || (expectedClubId && raw.club_id !== expectedClubId)) return null;
  const id = uuid(raw.id ?? raw.menu_id);
  const name = string(raw.name ?? raw.menu_name);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: nullableString(raw.description ?? raw.notes),
    category: nullableString(raw.category),
    design: null,
    items: array(raw.items ?? raw.menu_items)
      .map(menuItem)
      .filter((item): item is JsonValue => item !== null),
  };
}

function homeRecord(value: unknown, expectedClubId?: UUID): JsonValue {
  const tabs = array(value).flatMap((entry): JsonValue[] => {
    const raw = object(entry);
    const id = uuid(raw?.id);
    const label = string(raw?.label);
    const slug = string(raw?.slug);
    if (!raw || raw.visibility_scope !== "public" || raw.is_active !== true || !id || !label || !slug
      || (expectedClubId && raw.club_id !== expectedClubId)) return [];
    const widgets = array(raw.widgets).flatMap((widget): JsonValue[] => {
      const item = object(widget);
      const widgetId = uuid(item?.id);
      const kind = string(item?.kind);
      if (!item || item.is_active !== true || !widgetId || !kind
        || (expectedClubId && item.club_id !== expectedClubId)
        || (item.tab_id !== undefined && item.tab_id !== id)) return [];
      return [{
        id: widgetId,
        kind,
        title: nullableString(item.title),
        position: typeof item.position === "number" && item.position >= 0 ? Math.trunc(item.position) : 0,
      }];
    });
    return [{
      id,
      label,
      slug,
      icon: nullableString(raw.icon),
      navigation_group: nullableString(raw.navigation_group),
      position: typeof raw.position === "number" && raw.position >= 0 ? Math.trunc(raw.position) : 0,
      widgets,
    }];
  });
  return { tabs };
}

export class PublicResponseRedactor {
  readonly #policy: PublicAccessPolicy;

  constructor(policy = new PublicAccessPolicy()) {
    this.#policy = policy;
  }

  redact(input: {
    alias: PublicResolverAlias;
    response: unknown;
    request_id: UUID;
    expected_club_id?: UUID;
  }): JsonValue {
    this.#policy.assertPublishable(input.alias);
    if (CLUB_SCOPED_ALIASES.has(input.alias) && !input.expected_club_id) {
      throw runtimeError({
        code: "CONFIG_INVALID",
        message: "Der öffentliche Resolver benötigt einen expliziten Vereinskontext.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    const raw = object(input.response);
    let redacted: JsonValue | null;
    switch (input.alias) {
      case "public_club_by_slug":
      case "public_club_by_domain": {
        const name = string(raw?.name);
        const slug = string(raw?.slug);
        redacted = name && slug ? { name, slug } : null;
        break;
      }
      case "public_club_profile": {
        const clubId = uuid(raw?.club_id ?? raw?.id);
        const name = string(raw?.name);
        redacted = clubId && name && (!input.expected_club_id || clubId === input.expected_club_id) ? {
          club_id: clubId,
          name,
          short_name: nullableString(raw?.short_name),
          description: nullableString(raw?.description),
          logo_url: nullableString(raw?.logo_url),
          public_contact: null,
        } : null;
        break;
      }
      case "public_club_home":
        redacted = homeRecord(input.response, input.expected_club_id);
        break;
      case "public_club_legal":
        redacted = raw && (!input.expected_club_id || raw.club_id === input.expected_club_id) ? {
          club_name: string(raw.club_name) ?? "",
          legal_form: nullableString(raw.legal_form),
          register_number: nullableString(raw.register_number),
          address: nullableString(raw.address),
          postal_code: nullableString(raw.postal_code),
          city: nullableString(raw.city),
          country: nullableString(raw.country),
          email: nullableString(raw.email),
          phone: nullableString(raw.phone),
          website: nullableString(raw.website),
          responsible_label: string(raw.responsible_label) ?? "Verantwortlicher Verein",
          responsibility_text: string(raw.responsibility_text) ?? "Verantwortlich für die Inhalte ist der Verein.",
        } : null;
        break;
      case "public_events":
        redacted = array(input.response).map((entry) => eventRecord(entry, input.expected_club_id))
          .filter((entry): entry is JsonValue => entry !== null);
        break;
      case "public_event_attachments":
        redacted = array(input.response).flatMap((entry): JsonValue[] => {
          const item = object(entry);
          const id = uuid(item?.id);
          const name = string(item?.name);
          const mimeType = string(item?.mime_type);
          const size = number(item?.size);
          const url = string(item?.url);
          return id && name && mimeType && size !== null && url
            ? [{ id, name, mime_type: mimeType, size, url }]
            : [];
        });
        break;
      case "public_training":
        redacted = array(input.response).flatMap((entry): JsonValue[] => {
          const item = object(entry);
          const id = uuid(item?.id);
          const title = string(item?.title);
          return id && title ? [{
            id,
            title,
            location: nullableString(item?.location),
            start: nullableString(item?.start ?? item?.start_time),
            end: nullableString(item?.end ?? item?.end_time),
          }] : [];
        });
        break;
      case "public_news":
      case "public_department_news":
        redacted = array(input.response).map((entry) => newsRecord(entry, input.expected_club_id))
          .filter((entry): entry is JsonValue => entry !== null);
        break;
      case "public_news_detail":
        redacted = newsRecord(input.response, input.expected_club_id);
        break;
      case "public_menu":
      case "public_event_menu":
        redacted = menuRecord(input.response, input.expected_club_id);
        break;
      case "public_sponsors":
        redacted = array(input.response).flatMap((entry): JsonValue[] => {
          const item = object(entry);
          const id = uuid(item?.advertiser_id ?? item?.id);
          const name = string(item?.display_name ?? item?.company_name);
          if (!id || !name || (input.expected_club_id && item?.club_id !== input.expected_club_id)) return [];
          return [{
            advertiser_id: id,
            display_name: name,
            logo_url: nullableString(item?.logo_url),
            target_url: nullableString(item?.target_url ?? item?.website_url),
            label: nullableString(item?.label ?? item?.organization_type),
          }];
        });
        break;
    }
    if (redacted === null) {
      throw runtimeError({
        code: "NOT_FOUND",
        message: "Die öffentliche Ressource wurde nicht gefunden.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    const parsed = PUBLIC_OUTPUT_SCHEMAS[input.alias].safeParse(redacted);
    if (!parsed.success) {
      throw runtimeError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "Die öffentliche Ressource konnte nicht sicher verarbeitet werden.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    return parsed.data as JsonValue;
  }
}
