import { expect, test } from "bun:test";
import { executeK10Operation } from "../src/tools/booking-object-task/handlers.ts";
import { K10_ACTION_SCHEMAS } from "../src/tools/booking-object-task/schemas.ts";

type Args = Parameters<typeof executeK10Operation>;
const clubId = "11111111-1111-4111-8111-111111111111";
const context = { club_id: clubId, request_id: "synthetic" } as Args[3];
const tasks = Array.from({ length: 60 }, (_, index) => ({ id: String(index), club_id: clubId, title: `Task ${index}` }));

for (const operation of ["list", "mine"]) {
  test(`${operation} honors explicit offset and limit after tenant checks`, async () => {
    const input = K10_ACTION_SCHEMAS["cai.task.01.list"].input.parse({ club_id: clubId, operation, limit: 2, offset: 3 }) as Args[2];
    const client = { request: async () => tasks } as unknown as Args[4];
    const result = await executeK10Operation("cai.task.01.list", operation, input, context, client);
    expect(result).toEqual(tasks.slice(3, 5));
  });
  test(`${operation} uses schema defaults and returns empty past end`, async () => {
    const schema = K10_ACTION_SCHEMAS["cai.task.01.list"].input;
    const client = { request: async () => tasks } as unknown as Args[4];
    const result = await executeK10Operation("cai.task.01.list", operation, schema.parse({ club_id: clubId, operation }) as Args[2], context, client);
    expect(result).toHaveLength(50);
    expect(await executeK10Operation("cai.task.01.list", operation, schema.parse({ club_id: clubId, operation, offset: 100 }) as Args[2], context, client)).toEqual([]);
  });
  test(`${operation} rejects a malformed source instead of empty success`, async () => {
    const client = { request: async () => ({ error: "broken" }) } as unknown as Args[4];
    await expect(executeK10Operation("cai.task.01.list", operation, { club_id: clubId, operation, limit: 50, offset: 0 }, context, client)).rejects.toThrow();
  });
}

test("pagination never hides foreign-tenant rows outside the selected page", async () => {
  const foreign = { ...tasks[0]!, club_id: "22222222-2222-4222-8222-222222222222" };
  const client = { request: async () => [...tasks, foreign] } as unknown as Args[4];
  await expect(executeK10Operation("cai.task.01.list", "mine", { club_id: clubId, operation: "mine", limit: 1, offset: 0 }, context, client)).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
});
