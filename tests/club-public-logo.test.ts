import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchPublicClubLogo } from "../src/commands/club";

const CLUB = "8d61babd-47ab-406e-b823-0dc04cf03f6b";

function fakeFetch(routes: Record<string, Response>, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const hit = routes[url];
    if (!hit) throw new Error(`unexpected ${url}`);
    return hit.clone();
  }) as typeof fetch;
}

test("loads the public logo by slug without sign-in and saves it", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "logo-")), "logo.png");
  const seen: string[] = [];
  const logo = await fetchPublicClubLogo("SV-Motzing", out, "prod", fakeFetch({
    "https://api.comvenio.app/club/public/clubs/by-slug/sv-motzing": Response.json({ id: CLUB, name: "SV Motzing", color_theme_1: "#0E847B" }),
    [`https://api.comvenio.app/content/logos/club/${CLUB}/download-url`]: Response.json({ url: "https://files.example/logo.png", expires_in: 300 }),
    "https://files.example/logo.png": new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
  }, seen));
  expect(logo).toMatchObject({ club_id: CLUB, name: "SV Motzing", farbe: "#0E847B", content_type: "image/png", bytes: 4 });
  expect([...readFileSync(out)]).toEqual([137, 80, 78, 71]);
  expect(seen.every((u) => !u.includes("/members") && !u.includes("/private"))).toBe(true);
});

test("an unknown slug or a club without logo stops with the club named", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "logo-")), "x.png");
  await expect(fetchPublicClubLogo("gibtsnicht", out, "prod", fakeFetch({
    "https://api.comvenio.app/club/public/clubs/by-slug/gibtsnicht": new Response("", { status: 404 }),
  }))).rejects.toThrow("gibtsnicht");
  await expect(fetchPublicClubLogo("jagabluat", out, "dev", fakeFetch({
    "https://apidev.comvenio.app/club/public/clubs/by-slug/jagabluat": Response.json({ id: CLUB, name: "Jagabluat" }),
    [`https://apidev.comvenio.app/content/logos/club/${CLUB}/download-url`]: new Response("", { status: 404 }),
  }))).rejects.toThrow("Jagabluat hat kein öffentliches Vereinslogo");
});

test("path-like slugs and unknown environments are refused before any request", async () => {
  const none = fakeFetch({});
  await expect(fetchPublicClubLogo("../clubs", "/tmp/x", "prod", none)).rejects.toThrow("kein gültiger Slug");
  await expect(fetchPublicClubLogo("sv-motzing", "/tmp/x", "local", none)).rejects.toThrow("--env");
  await expect(fetchPublicClubLogo("sv-motzing", "", "prod", none)).rejects.toThrow("--out");
});
