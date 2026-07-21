import type { ComvenioApiClient } from "@comvenio/comvenio-client";
import type { JsonValue, UUID } from "@comvenio/connector-contracts";

import { runtimeError } from "../http/errors.ts";
import { PublicAccessPolicy } from "./policy.ts";
import { PUBLIC_INPUT_SCHEMAS } from "./schemas.ts";
import type {
  AnonymousClubPublicView,
  AnonymousClubResolutionInput,
  PublicResolverAlias,
} from "./types.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export class AnonymousClubContext {
  readonly #clubId: UUID;
  readonly #publicView: AnonymousClubPublicView;

  constructor(input: { club_id: UUID; name: string; slug: string }) {
    this.#clubId = input.club_id;
    this.#publicView = Object.freeze({ name: input.name, slug: input.slug });
  }

  toPublicView(): AnonymousClubPublicView {
    return structuredClone(this.#publicView);
  }

  toJSON(): AnonymousClubPublicView {
    return this.toPublicView();
  }

  upstreamClubId(): UUID {
    return this.#clubId;
  }
}

export class AnonymousClubResolver {
  readonly #client: ComvenioApiClient;
  readonly #policy: PublicAccessPolicy;

  constructor(input: { client: ComvenioApiClient; policy: PublicAccessPolicy }) {
    this.#client = input.client;
    this.#policy = input.policy;
  }

  async resolve(input: AnonymousClubResolutionInput): Promise<AnonymousClubContext> {
    const context = this.#policy.assertAnonymousContext(input.context);
    const useDomain = "domain" in input.selection;
    const alias: PublicResolverAlias = useDomain ? "public_club_by_domain" : "public_club_by_slug";
    if (!useDomain && input.environment === "production") {
      throw runtimeError({
        code: "NOT_FOUND",
        message: "Die öffentliche Ressource wurde nicht gefunden.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    const parsed = PUBLIC_INPUT_SCHEMAS[alias].safeParse(input.selection);
    if (!parsed.success) {
      throw runtimeError({
        code: "VALIDATION_FAILED",
        message: "Die öffentliche Vereinsauswahl ist ungültig.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    const value = parsed.data as { domain?: string; slug?: string };
    const locator = value.domain ?? value.slug!;
    const contract = this.#policy.assertPublishable(alias);
    const path = contract.normalized_path_template.replace(
      useDomain ? "{domain}" : "{slug}",
      encodeURIComponent(locator),
    );
    let response: JsonValue;
    try {
      response = await this.#client.request({
        method: "GET",
        service: "club",
        path,
        context,
      });
    } catch (error) {
      return this.#policy.normalizeHiddenResource(error, context.request_id);
    }
    const record = object(response);
    const clubId = typeof record?.club_id === "string" ? record.club_id
      : typeof record?.id === "string" ? record.id : null;
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const slugValue = typeof record?.slug === "string" ? record.slug.trim().toLowerCase() : "";
    if (!clubId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(clubId)
      || !name || !PUBLIC_INPUT_SCHEMAS.public_club_by_slug.safeParse({ slug: slugValue }).success) {
      throw runtimeError({
        code: "NOT_FOUND",
        message: "Die öffentliche Ressource wurde nicht gefunden.",
        request_id: context.request_id,
        retryable: false,
      });
    }
    return new AnonymousClubContext({ club_id: clubId, name, slug: slugValue });
  }
}
