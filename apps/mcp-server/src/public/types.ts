import type { OAuthEnvironment } from "@comvenio/auth";
import type {
  JsonValue,
  OAuthScope,
  RequestContext,
  UUID,
} from "@comvenio/connector-contracts";
import type {
  BackendRoutePermissionAuditEntry,
  RouteTraceStep,
} from "@comvenio/tool-catalog";

export const PUBLIC_RESOLVER_ALIASES = [
  "public_club_by_slug",
  "public_club_by_domain",
  "public_club_profile",
  "public_club_home",
  "public_club_legal",
  "public_events",
  "public_event_attachments",
  "public_training",
  "public_news",
  "public_news_detail",
  "public_department_news",
  "public_menu",
  "public_event_menu",
  "public_sponsors",
] as const;

export type PublicResolverAlias = (typeof PUBLIC_RESOLVER_ALIASES)[number];
export type PublicDomain = "club" | "event" | "news" | "menu" | "sponsor";

export interface PublicReadContract {
  alias: PublicResolverAlias;
  domain: PublicDomain;
  service: "club" | "event" | "content" | "supply" | "marketing";
  method: "GET";
  normalized_path_template: string;
  availability: "all_environments" | "development_only";
  required_scope: "public.read";
  authorization: "absent";
  backend_authentication: "public";
  response_allowlist: readonly string[];
  publication_state: "verified" | "blocked";
  blocker: string | null;
}

export interface PublicRouteEvidence {
  trace: RouteTraceStep;
  audit: BackendRoutePermissionAuditEntry;
}

export interface PublicToolDescriptor {
  resolver_alias: PublicResolverAlias;
  title: string;
  description: string;
  required_scopes: readonly ["public.read"];
  read_only: true;
}

export interface ProtectedToolDescriptor {
  tool_name: string;
  required_scopes: readonly OAuthScope[];
}

export interface PublicToolCandidate {
  tool_name: string;
  resolver_alias: PublicResolverAlias | null;
  required_scopes: readonly OAuthScope[];
  risk_class: "read" | "reversible_write" | "critical_write";
}

export interface RequestAccessDecision {
  anonymous_allowed: boolean;
  required_scopes: OAuthScope[];
  reason: "PUBLIC_PROTOCOL" | "PUBLIC_TOOL" | "OAUTH_REQUIRED";
}

export interface McpRequestAccessPolicy {
  classify(body: unknown): RequestAccessDecision;
}

export interface AuthChallenge {
  status: 401;
  request_id: UUID;
  resource_metadata: `https://${string}`;
  required_scopes: OAuthScope[];
  www_authenticate: string;
  message: string;
}

export type AnonymousClubSelection =
  | { domain: string; slug?: never }
  | { slug: string; domain?: never };

export interface AnonymousClubPublicView extends Record<string, JsonValue> {
  name: string;
  slug: string;
}

export interface AnonymousClubResolutionInput {
  selection: AnonymousClubSelection;
  environment: OAuthEnvironment;
  context: RequestContext;
}

export interface PublicBackendRequest {
  alias: PublicResolverAlias;
  service: PublicReadContract["service"];
  method: "GET";
  path: string;
  query?: Record<string, string | string[]>;
  context: RequestContext;
}
