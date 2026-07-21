import type { JsonPrimitive, JsonValue, RequestContext } from "@comvenio/connector-contracts";
import type {
  ComvenioApiClient,
  ComvenioApiRequest,
} from "@comvenio/comvenio-client";

import { fixtureIdsAsRecord } from "./route-audit.ts";
import type {
  FixtureStore,
  RouteTraceFixture,
  SchemaRegistry,
  SharedHandlerRegistry,
} from "./types.ts";
import {
  assertCatalog,
  assertMatchesJsonSchema,
  canonicalJson,
} from "./validation.ts";

type RecordingRequest = ComvenioApiRequest & {
  idempotency_key?: string;
};

function renderExpectedPath(
  template: string,
  parameters: Readonly<Record<string, JsonPrimitive>>,
): string {
  let result = template;
  for (const [key, raw] of Object.entries(parameters)) {
    assertCatalog(raw !== null, `Pfadparameter ${key} darf nicht null sein.`, "ROUTE_TRACE_MISMATCH");
    result = result.replaceAll(`{${key}}`, encodeURIComponent(String(raw)));
  }
  assertCatalog(!/\{[^}]+\}/u.test(result), "Nicht aufgelöster Route-Trace-Pfadparameter.",
    "ROUTE_TRACE_MISMATCH");
  return result;
}

function normalizedQuery(query: ComvenioApiRequest["query"]): Record<string, string[]> {
  return Object.fromEntries(Object.keys(query ?? {}).sort().map((key) => {
    const raw = query?.[key];
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    return [key, [...values].sort()];
  }));
}

function expectedQuery(query: Readonly<Record<string, string | string[]>>): Record<string, string[]> {
  return Object.fromEntries(Object.keys(query).sort().map((key) => {
    const raw = query[key];
    return [key, (Array.isArray(raw) ? [...raw] : [raw as string]).sort()];
  }));
}

export class FailClosedRecordingComvenioClient implements ComvenioApiClient {
  readonly timeout_ms = 15000 as const;
  readonly fixture: RouteTraceFixture;
  consumed_steps = 0;

  readonly #fixtures: FixtureStore;
  readonly #schemas: SchemaRegistry;
  readonly #handlers: SharedHandlerRegistry;
  readonly #context: RequestContext;

  constructor(input: {
    fixture: RouteTraceFixture;
    fixtures: FixtureStore;
    schemas: SchemaRegistry;
    handlers: SharedHandlerRegistry;
    context: RequestContext;
  }) {
    this.fixture = input.fixture;
    this.#fixtures = input.fixtures;
    this.#schemas = input.schemas;
    this.#handlers = input.handlers;
    this.#context = input.context;
  }

  async request<T extends JsonValue>(request: RecordingRequest): Promise<T> {
    const step = this.fixture.steps[this.consumed_steps];
    assertCatalog(step, `${this.fixture.operation_id}: Unerwarteter zusätzlicher Upstream-Aufruf.`,
      "ROUTE_TRACE_MISMATCH");
    assertCatalog(request.context.request_id === this.#context.request_id,
      `${this.fixture.operation_id}: RequestContext wurde ausgetauscht.`, "ROUTE_TRACE_MISMATCH");
    assertCatalog(request.method === step.http_method, `${this.fixture.operation_id}: HTTP-Methode weicht ab.`,
      "ROUTE_TRACE_MISMATCH");
    assertCatalog(request.service === step.service, `${this.fixture.operation_id}: Service weicht ab.`,
      "ROUTE_TRACE_MISMATCH");
    assertCatalog(
      request.path === renderExpectedPath(
        step.normalized_path_template,
        step.request_matcher.path_parameters,
      ),
      `${this.fixture.operation_id}: Pfad weicht ab.`,
      "ROUTE_TRACE_MISMATCH",
    );
    assertCatalog(
      canonicalJson(normalizedQuery(request.query) as unknown as JsonValue)
        === canonicalJson(expectedQuery(step.request_matcher.query_parameters) as unknown as JsonValue),
      `${this.fixture.operation_id}: Query-Parameter weichen ab.`,
      "ROUTE_TRACE_MISMATCH",
    );
    if (step.request_matcher.authorization === "fixture_bearer_required") {
      assertCatalog(request.context.subject_id !== null,
        `${this.fixture.operation_id}: Fixture-Bearer fehlt.`, "ROUTE_TRACE_MISMATCH");
    } else {
      assertCatalog(request.context.oauth_grant_id === null,
        `${this.fixture.operation_id}: Öffentliche Fixture darf keinen OAuth-Grant senden.`,
        "ROUTE_TRACE_MISMATCH");
    }
    const actualContentType = request.body === undefined ? null : "application/json";
    assertCatalog(actualContentType === step.request_matcher.content_type,
      `${this.fixture.operation_id}: Content-Type weicht ab.`, "ROUTE_TRACE_MISMATCH");
    if (step.request_matcher.idempotency_key === "fixture_uuid_required") {
      const fixtureIdsValue = this.#fixtures.get(this.fixture.fixture_ids_ref);
      assertCatalog(fixtureIdsValue !== undefined, "Fixture-IDs fehlen.", "ROUTE_TRACE_MISMATCH");
      const fixtureIds = fixtureIdsAsRecord(fixtureIdsValue);
      assertCatalog(typeof request.idempotency_key === "string"
        && Object.values(fixtureIds).includes(request.idempotency_key),
      `${this.fixture.operation_id}: Idempotency-Key ist nicht fixturegebunden.`,
      "ROUTE_TRACE_MISMATCH");
    } else {
      assertCatalog(request.idempotency_key === undefined,
        `${this.fixture.operation_id}: Unerwarteter Idempotency-Key.`, "ROUTE_TRACE_MISMATCH");
    }

    const bodyRef = step.request_matcher.body_fixture_ref;
    if (bodyRef === null) {
      assertCatalog(request.body === undefined,
        `${this.fixture.operation_id}: Unerwarteter Request-Body.`, "ROUTE_TRACE_MISMATCH");
    } else {
      const expectedBody = this.#fixtures.get(bodyRef);
      assertCatalog(expectedBody !== undefined, `${this.fixture.operation_id}: Body-Fixture fehlt.`,
        "ROUTE_TRACE_MISMATCH");
      assertCatalog(request.body !== undefined && canonicalJson(request.body) === canonicalJson(expectedBody),
        `${this.fixture.operation_id}: Request-Body weicht ab.`, "ROUTE_TRACE_MISMATCH");
      if (step.request_schema_ref) {
        const schema = this.#schemas.get(step.request_schema_ref);
        assertCatalog(schema, `${this.fixture.operation_id}: Request-Schema fehlt.`, "SCHEMA_INVALID");
        assertMatchesJsonSchema(request.body, schema, step.request_schema_ref);
      }
    }

    const response = this.#fixtures.get(step.response_fixture_ref);
    assertCatalog(response !== undefined, `${this.fixture.operation_id}: Response-Fixture fehlt.`,
      "ROUTE_TRACE_MISMATCH");
    const responseSchema = this.#schemas.get(step.response_schema_ref);
    assertCatalog(responseSchema, `${this.fixture.operation_id}: Response-Schema fehlt.`, "SCHEMA_INVALID");
    assertMatchesJsonSchema(response, responseSchema, step.response_schema_ref);
    this.consumed_steps++;
    return structuredClone(response) as T;
  }

  async execute(sharedHandlerRef: string, operationInput: JsonValue): Promise<JsonValue> {
    const expectedInput = this.#fixtures.get(this.fixture.operation_input_fixture_ref);
    assertCatalog(expectedInput !== undefined, `${this.fixture.operation_id}: Input-Fixture fehlt.`,
      "ROUTE_TRACE_MISMATCH");
    assertCatalog(canonicalJson(operationInput) === canonicalJson(expectedInput),
      `${this.fixture.operation_id}: Operation-Input weicht von der Fixture ab.`,
      "ROUTE_TRACE_MISMATCH");
    const handler = this.#handlers.get(sharedHandlerRef);
    assertCatalog(handler, `${this.fixture.operation_id}: Shared Handler ist nicht registriert.`,
      "ROUTE_TRACE_MISMATCH");
    const fixtureIdsValue = this.#fixtures.get(this.fixture.fixture_ids_ref);
    assertCatalog(fixtureIdsValue !== undefined, "Fixture-IDs fehlen.", "ROUTE_TRACE_MISMATCH");
    const result = await handler(operationInput, {
      client: this,
      context: this.#context,
      now: () => this.fixture.fixture_clock,
      fixture_ids: fixtureIdsAsRecord(fixtureIdsValue),
    });
    this.assert_complete();
    const terminalSchema = this.#schemas.get(this.fixture.terminal_output_schema_ref);
    assertCatalog(terminalSchema, `${this.fixture.operation_id}: Terminal-Schema fehlt.`, "SCHEMA_INVALID");
    assertMatchesJsonSchema(result, terminalSchema, this.fixture.terminal_output_schema_ref);
    return result;
  }

  assert_complete(): void {
    assertCatalog(this.consumed_steps === this.fixture.steps.length,
      `${this.fixture.operation_id}: Route-Trace ist unvollständig (${this.consumed_steps}/${this.fixture.steps.length}).`,
      "ROUTE_TRACE_MISMATCH");
  }
}
