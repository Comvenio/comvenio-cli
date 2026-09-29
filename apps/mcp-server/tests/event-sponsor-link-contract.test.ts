import { expect, test } from "bun:test";
import { executeK8Operation } from "../src/tools/event-plan/handlers.ts";
import { K8_ACTION_SCHEMAS } from "../src/tools/event-plan/schemas.ts";

type Args = Parameters<typeof executeK8Operation>;
const action = "cai.event.18.sponsor_and_sponsor_program_workflows" as const;
const club = "11111111-1111-4111-8111-111111111111";
const event = "22222222-2222-4222-8222-222222222222";
const advertiser = "33333333-3333-4333-8333-333333333333";
const base = { club_id: club, event_id: event, operation: "link_add" };
const schema = K8_ACTION_SCHEMAS[action].input;

for (const extras of [{}, { area_id: null, tier: "gold", sort_order: 3 }]) {
  test(`sponsor link uses actual backend fields with club binding ${JSON.stringify(extras)}`, async () => {
    const input = schema.parse({ ...base, link: { advertiser_id: advertiser, ...extras } }) as Args[2];
    const requests: unknown[] = [];
    const client = { request: async (request: unknown) => { requests.push(request); return { id: advertiser }; } } as unknown as Args[4];
    await executeK8Operation(action, "link_add", input, { club_id: club, request_id: "synthetic" } as Args[3], client);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", path: `/events/${event}/sponsor-links`, body: { club_id: club, advertiser_id: advertiser, sort_order: 0, ...extras } });
  });
}

for (const link of [{ sponsor_id: advertiser }, { advertiser_id: advertiser, amount: 10 }, { advertiser_id: advertiser, notes: "unsupported" }, { advertiser_id: advertiser, club_id: event }]) {
  test(`reject unsupported or actor-controlled sponsor fields ${JSON.stringify(link)}`, () => {
    expect(() => schema.parse({ ...base, link })).toThrow();
  });
}
