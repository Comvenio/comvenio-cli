import { describe, expect, test } from "bun:test";

import { resolveUploadDepartment } from "../src/commands/data.ts";

// 2026-09-19 (Jagabluat): CLI uploads without department were invisible in the
// DataShare. DataShare contexts now default to the club's standard department.
describe("data upload: department", () => {
  const client = (departments: Array<{ id: string; is_default?: boolean }>) => {
    const calls: string[] = [];
    return {
      calls,
      get: async <T>(_service: string, path: string) => {
        calls.push(path);
        return departments as T;
      },
    };
  };

  test("uses the standard department for DataShare contexts", async () => {
    const c = client([{ id: "sport" }, { id: "standard", is_default: true }]);
    for (const context of ["club", "none", "department"]) {
      expect(await resolveUploadDepartment(c, "club 1", context, undefined)).toBe("standard");
    }
    expect(c.calls[0]).toBe("/departments/by_club/club%201");
  });

  test("an explicit department wins, 'none' uploads without department", async () => {
    const c = client([{ id: "standard", is_default: true }]);
    expect(await resolveUploadDepartment(c, "club", "club", "sport")).toBe("sport");
    expect(await resolveUploadDepartment(c, "club", "club", "none")).toBeUndefined();
    expect(c.calls).toEqual([]);
  });

  test("other contexts keep the server's rules", async () => {
    const c = client([{ id: "standard", is_default: true }]);
    for (const context of ["event", "news", "certificate", "tournament"]) {
      expect(await resolveUploadDepartment(c, "club", context, undefined)).toBeUndefined();
    }
    expect(c.calls).toEqual([]);
  });

  test("fails with a clear hint when the club has no standard department", async () => {
    await expect(resolveUploadDepartment(client([{ id: "sport" }]), "club", "club", undefined))
      .rejects.toThrow("Keine Standard-Abteilung gefunden");
  });
});
