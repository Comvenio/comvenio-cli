import { expect, test } from "bun:test";
import { publicOrganPath } from "../src/commands/club";

const club = "8d61babd-47ab-406e-b823-0dc04cf03f6b";
const group = "00000000-0000-4000-8000-000000000001";
test("public organ reads avatars only when requested", () => {
  expect(publicOrganPath(club, group)).toBe(`/public/clubs/${club}/organs/${group}?include_avatars=false`);
  expect(publicOrganPath(club, group, true)).toEndWith("?include_avatars=true");
});
test("public organ rejects absent and path-like selectors", () => {
  expect(() => publicOrganPath(club, undefined)).toThrow();
  expect(() => publicOrganPath(club, "../settings")).toThrow();
  expect(() => publicOrganPath("../../clubs", group)).toThrow();
});

test("public organ preview stays explicitly scoped and rejects query injection", () => {
  expect(publicOrganPath(club, group, true, group)).toEndWith(`&preview_id=${group}`);
  expect(() => publicOrganPath(club, group, true, "x&other=y")).toThrow();
  expect(() => publicOrganPath(club, group, true, "")).toThrow();
});
