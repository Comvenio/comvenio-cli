import type {
  PublicReadContract,
  PublicResolverAlias,
} from "./types.ts";

const contracts = [
  ["public_club_by_slug", "club", "club", "/public/clubs/by-slug/{slug}", "development_only", ["club_id", "slug", "name"]],
  ["public_club_by_domain", "club", "club", "/public/clubs/by-domain/{domain}", "all_environments", ["club_id", "slug", "name"]],
  ["public_club_profile", "club", "club", "/public/clubs/{club_id}/profile", "all_environments", ["club_id", "name", "short_name", "description", "logo_url", "public_contact"]],
  ["public_club_home", "club", "club", "/public/clubs/{club_id}/home", "all_environments", ["tabs"]],
  ["public_club_legal", "club", "club", "/public/clubs/{club_id}/legal", "all_environments", ["club_name", "legal_form", "register_number", "address", "postal_code", "city", "country", "email", "phone", "website", "responsible_label", "responsibility_text"]],
  ["public_events", "event", "event", "/public/clubs/{club_id}/events", "all_environments", ["id", "title", "summary", "start", "end", "timezone", "location", "is_public", "cover_url"]],
  ["public_event_attachments", "event", "event", "/public/events/{event_id}/attachments", "all_environments", ["id", "name", "mime_type", "size", "url"]],
  ["public_training", "event", "event", "/public/clubs/{club_id}/training", "all_environments", ["id", "title", "location", "start", "end"]],
  ["public_news", "news", "content", "/news/club/public/{club_id}", "all_environments", ["id", "title", "summary", "sanitized_html", "hero_url", "published_at", "author_display_name"]],
  ["public_news_detail", "news", "content", "/news/{news_id}", "all_environments", ["id", "title", "summary", "sanitized_html", "hero_url", "published_at", "author_display_name"]],
  ["public_department_news", "news", "content", "/news/department/public/{club_id}", "all_environments", ["id", "title", "summary", "sanitized_html", "hero_url", "published_at", "author_display_name"]],
  ["public_menu", "menu", "supply", "/menu/club/{club_id}/menus/{menu_id}/public", "all_environments", ["id", "name", "description", "category", "design", "items"]],
  ["public_event_menu", "menu", "supply", "/menu/events/{event_id}/public-menu", "all_environments", ["id", "name", "description", "category", "design", "items"]],
  ["public_sponsors", "sponsor", "marketing", "/public/by-club", "all_environments", ["advertiser_id", "display_name", "logo_url", "target_url", "label"]],
] as const;

export const PUBLIC_READ_CONTRACTS = Object.freeze(Object.fromEntries(contracts.map((entry) => {
  const [alias, domain, service, normalizedPathTemplate, availability, responseAllowlist] = entry;
  return [alias, Object.freeze({
    alias,
    domain,
    service,
    method: "GET",
    normalized_path_template: normalizedPathTemplate,
    availability,
    required_scope: "public.read",
    authorization: "absent",
    backend_authentication: "public",
    response_allowlist: Object.freeze([...responseAllowlist]),
    publication_state: alias === "public_sponsors" ? "blocked" : "verified",
    blocker: alias === "public_sponsors"
      ? "Der revisionsgebundene Pfad /public/by-club weicht von der verifizierten Backendroute /advertisers/public/by-club ab."
      : null,
  })];
})) as Record<PublicResolverAlias, PublicReadContract>);
