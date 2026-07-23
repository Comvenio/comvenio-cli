import type { OAuthScope } from "@comvenio/connector-contracts";

import { PUBLIC_READ_CONTRACTS } from "./contracts.ts";
import type {
  McpRequestAccessPolicy,
  ProtectedToolDescriptor,
  PublicToolCandidate,
  PublicResolverAlias,
  PublicToolDescriptor,
  RequestAccessDecision,
} from "./types.ts";

const TITLES: Record<PublicResolverAlias, string> = {
  public_club_by_slug: "Öffentlichen Verein per Entwicklungs-Slug finden",
  public_club_by_domain: "Öffentlichen Verein per Domain finden",
  public_club_profile: "Öffentliches Vereinsprofil anzeigen",
  public_club_home: "Öffentliche Vereinshomepage anzeigen",
  public_club_legal: "Öffentliche Vereinsangaben anzeigen",
  public_events: "Öffentliche Veranstaltungen anzeigen",
  public_event_attachments: "Öffentliche Veranstaltungsmedien anzeigen",
  public_training: "Öffentliche Trainingszeiten anzeigen",
  public_news: "Öffentliche Vereinsnews anzeigen",
  public_news_detail: "Öffentlichen Newsbeitrag anzeigen",
  public_department_news: "Öffentliche Abteilungsnews anzeigen",
  public_menu: "Öffentliche Speisekarte anzeigen",
  public_event_menu: "Öffentliche Veranstaltungskarte anzeigen",
  public_sponsors: "Veröffentlichte Sponsoren anzeigen",
};

const USAGE_HINTS: Partial<Record<PublicResolverAlias, string>> = {
  public_events: "Bei einer aktiven Verbindung zuerst cv_whoami_read ohne Eingabe aufrufen und dessen club_id verwenden.",
};

function rpcMessages(body: unknown): Array<Record<string, unknown>> {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter((message): message is Record<string, unknown> =>
    message !== null && typeof message === "object" && !Array.isArray(message));
}

function calledToolNames(body: unknown): string[] {
  return rpcMessages(body).flatMap((message) => {
    if (message.method !== "tools/call" || message.params === null
      || typeof message.params !== "object" || Array.isArray(message.params)) return [];
    const name = (message.params as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
}

export class PublicToolSubset implements McpRequestAccessPolicy {
  readonly #publicToolNames: ReadonlySet<string>;
  readonly #publicAliases: ReadonlySet<PublicResolverAlias>;
  readonly #protectedScopes: ReadonlyMap<string, readonly OAuthScope[]>;

  constructor(input: {
    public_tools?: readonly PublicToolCandidate[];
    protected_tools?: readonly ProtectedToolDescriptor[];
  } = {}) {
    const publicTools = input.public_tools
      ?? Object.values(PUBLIC_READ_CONTRACTS)
        .filter((contract) => contract.publication_state === "verified")
        .map((contract) => ({
          tool_name: contract.alias,
          resolver_alias: contract.alias,
          required_scopes: ["public.read"] as const,
          risk_class: "read" as const,
        }));
    for (const tool of publicTools) {
      if (tool.resolver_alias === null
        || PUBLIC_READ_CONTRACTS[tool.resolver_alias].publication_state !== "verified"
        || tool.risk_class !== "read"
        || tool.required_scopes.length !== 1
        || tool.required_scopes[0] !== "public.read") {
        throw new Error(`${tool.tool_name}: Tool ist nicht als öffentlicher Read-Vertrag freigegeben.`);
      }
    }
    this.#publicToolNames = new Set(publicTools.map((tool) => tool.tool_name));
    this.#publicAliases = new Set(publicTools.map((tool) => tool.resolver_alias!));
    this.#protectedScopes = new Map<string, readonly OAuthScope[]>((input.protected_tools ?? []).map((tool) => [
      tool.tool_name,
      [...new Set<OAuthScope>(tool.required_scopes)].sort(),
    ]));
  }

  list(): PublicToolDescriptor[] {
    return (Object.keys(PUBLIC_READ_CONTRACTS) as PublicResolverAlias[])
      .filter((alias) => PUBLIC_READ_CONTRACTS[alias].publication_state === "verified"
        && this.#publicAliases.has(alias))
      .map((alias) => ({
        resolver_alias: alias,
        title: TITLES[alias],
        description: `${TITLES[alias]}. Es werden ausschließlich veröffentlichte, minimierte Felder geliefert.${USAGE_HINTS[alias] ? ` ${USAGE_HINTS[alias]}` : ""}`,
        required_scopes: ["public.read"] as const,
        read_only: true as const,
      }));
  }

  filterCatalog<T extends PublicToolCandidate>(candidates: readonly T[]): T[] {
    return candidates
      .filter((candidate) => candidate.resolver_alias !== null
        && Object.hasOwn(PUBLIC_READ_CONTRACTS, candidate.resolver_alias)
        && PUBLIC_READ_CONTRACTS[candidate.resolver_alias].publication_state === "verified"
        && candidate.risk_class === "read"
        && candidate.required_scopes.length === 1
        && candidate.required_scopes[0] === "public.read"
        && this.#publicToolNames.has(candidate.tool_name))
      .sort((left, right) => left.tool_name.localeCompare(right.tool_name))
      .map((candidate) => structuredClone(candidate));
  }

  classify(body: unknown): RequestAccessDecision {
    const names = calledToolNames(body);
    if (names.length === 0) {
      return { anonymous_allowed: true, required_scopes: ["public.read"], reason: "PUBLIC_PROTOCOL" };
    }
    const protectedNames = names.filter((name) => !this.#publicToolNames.has(name));
    if (protectedNames.length === 0) {
      return { anonymous_allowed: true, required_scopes: ["public.read"], reason: "PUBLIC_TOOL" };
    }
    const scopes: OAuthScope[] = protectedNames.flatMap((name) => {
      const configured = this.#protectedScopes.get(name);
      return configured ? [...configured] : ["public.read"];
    });
    return {
      anonymous_allowed: false,
      required_scopes: [...new Set(scopes)].sort(),
      reason: "OAUTH_REQUIRED",
    };
  }
}
