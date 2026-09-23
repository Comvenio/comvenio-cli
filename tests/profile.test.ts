import { describe, expect, test } from "bun:test";

import { cliProfile, profileSuffix } from "../src/profile.ts";

// A second sign-in (four-eyes approval): each profile gets its own state file
// and credential entry, the default keeps the paths it always had.
describe("CLI-Profil", () => {
  test("ohne Variable bleibt alles beim Standard", () => {
    expect(cliProfile({})).toBe("default");
    expect(profileSuffix("default")).toBe("");
  });

  test("ein benanntes Profil bekommt eigene Dateinamen", () => {
    expect(cliProfile({ COMVENIO_CLI_PROFILE: "pruefer" })).toBe("pruefer");
    expect(profileSuffix("pruefer")).toBe(".pruefer");
  });

  test("ein Profil mit Pfadzeichen wird abgewiesen", () => {
    expect(() => cliProfile({ COMVENIO_CLI_PROFILE: "../x" })).toThrow(/ungültig/);
    expect(() => cliProfile({ COMVENIO_CLI_PROFILE: "Pruefer" })).toThrow(/ungültig/);
  });
});
