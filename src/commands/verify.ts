import type { CAC } from "cac";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { readJsonFile } from "../util/file.ts";

// K11 — `comvenio verify <action>`: render a Comvenio web page headless and drop
// screenshots so the operating agent can SEE the result (Lastenheft Sub-File 11).
//   verify url <url>
//   verify event <event-id> [--child <id>] [--area <id>] [--token <t>]
//   verify menu <menu-id> [--print]
//   verify homepage [--file home.json]      (default: live {slug}.web.comvenio.app)
//   verify news <news-id>
//   verify certificate <honor-id>           (fetch-then-render HTML, RBAC manage_honors)
//
// Render tool = the systemwide `playwright-cli` (NOT embedded; called via Bun.spawn,
// same pattern as homepage.ts::openInBrowser). Targets are public; certificate +
// homepage --file fetch token-guarded in the CLI (the token works in the CLI, not
// the browser). gateway keys: "club" → club-service, "member" → member-service.

const OUT_DIR = ".comvenio-verify";
const PW_SESSION = "-s=cvn-verify";
const DEFAULT_WAIT_MS = 1500; // SPA settle time between open and screenshot

// Frontend base ≠ gateway base (Architektur-Anker 1). The HTTP client speaks the
// gateway (api.comvenio.app); verify RENDERS the frontend (web.comvenio.app).
function frontendBase(env: string, override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  return env === "dev" ? "https://web.dev.comvenio.app" : "https://web.comvenio.app";
}

type PwResult = { code: number; stdout: string; stderr: string };

// Run one playwright-cli subcommand in the shared verify session.
async function pw(args: string[]): Promise<PwResult> {
  const proc = Bun.spawn(["playwright-cli", PW_SESSION, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

// Pre-flight: is playwright-cli on PATH? (External dependency, no embed.)
async function hasPlaywrightCli(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["playwright-cli", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type VerifyOpts = {
  json?: boolean;
  club?: string;
  out?: string;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
  snapshot?: boolean; // cac: --no-snapshot → false
  console?: boolean; // cac: --no-console → false
  wait?: string;
  child?: string;
  area?: string;
  token?: string;
  print?: boolean;
  file?: string;
  frontendBase?: string;
};

type VerifyResult = {
  url: string;
  screenshots: { desktop?: string; mobile?: string };
  console_errors: string[];
  snapshot_taken: boolean;
  render_ms: number;
};

// Open the URL, capture Desktop + Mobile screenshots (full-page), console errors,
// and an ARIA snapshot. Returns the bundle; throws on a hard render failure.
async function renderBundle(
  url: string,
  name: string,
  opts: VerifyOpts,
): Promise<VerifyResult> {
  if (!(await hasPlaywrightCli())) {
    throw new Error(
      "playwright-cli nicht auf dem PATH gefunden. Installiere @playwright/cli " +
        "(npm i -g @playwright/cli) und einmalig `playwright-cli install`.",
    );
  }
  const outDir = opts.out ?? OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const waitMs = opts.wait ? Math.max(0, parseInt(opts.wait, 10) || 0) : DEFAULT_WAIT_MS;
  const started = Date.now();

  const open = await pw(["open", url]);
  if (open.code !== 0) {
    await pw(["close"]);
    throw new Error(`Render fehlgeschlagen (open ${url}): ${open.stderr.trim().slice(0, 200)}`);
  }
  await sleep(waitMs); // let the SPA fetch + paint before the shot

  const screenshots: VerifyResult["screenshots"] = {};
  if (!opts.mobileOnly) {
    await pw(["resize", "1440", "900"]);
    const f = `${outDir}/${name}-desktop.png`;
    await pw(["screenshot", "--full-page", "--filename", f]);
    screenshots.desktop = f;
  }
  if (!opts.desktopOnly) {
    await pw(["resize", "390", "844"]);
    const f = `${outDir}/${name}-mobile.png`;
    await pw(["screenshot", "--full-page", "--filename", f]);
    screenshots.mobile = f;
  }

  let consoleErrors: string[] = [];
  if (opts.console !== false) {
    const c = await pw(["console", "error"]);
    consoleErrors = c.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  let snapshotTaken = false;
  if (opts.snapshot !== false) {
    const s = await pw(["snapshot"]);
    snapshotTaken = s.code === 0;
  }
  await pw(["close"]);

  return {
    url,
    screenshots,
    console_errors: consoleErrors,
    snapshot_taken: snapshotTaken,
    render_ms: Date.now() - started,
  };
}

async function renderAndOutput(
  url: string,
  name: string,
  opts: VerifyOpts,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const result = await renderBundle(url, name, opts);
  output({ ...result, ...extra }, opts.json, () => {
    const lines = [`Gerendert: ${url} (${result.render_ms} ms)`];
    if (result.screenshots.desktop) lines.push(`  Desktop: ${result.screenshots.desktop}`);
    if (result.screenshots.mobile) lines.push(`  Mobile:  ${result.screenshots.mobile}`);
    lines.push(`  Console-Errors: ${result.console_errors.length}`);
    if (result.console_errors.length > 0) {
      lines.push(...result.console_errors.slice(0, 5).map((e) => `    • ${e.slice(0, 160)}`));
    }
    return lines.join("\n");
  });
}

export function registerVerifyCommands(cli: CAC): void {
  cli
    .command(
      "verify <action> [arg]",
      "Seite headless rendern + Screenshots: url | event | menu | homepage | news | certificate",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--out <dir>", "Zielordner fuer Screenshots", { default: OUT_DIR })
    .option("--desktop-only", "Nur Desktop-Screenshot (1440x900)")
    .option("--mobile-only", "Nur Mobile-Screenshot (390x844)")
    .option("--no-snapshot", "ARIA-Snapshot weglassen")
    .option("--no-console", "Console-Errors nicht einsammeln")
    .option("--wait <ms>", "Wartezeit nach Laden vor dem Screenshot (SPA-Settle)", { default: String(DEFAULT_WAIT_MS) })
    .option("--child <id>", "event: Festtag-/Child-Event-ID")
    .option("--area <id>", "event: Bereich-ID")
    .option("--token <t>", "event: Hub-Token (?token=...)")
    .option("--print", "menu: Druck-Ansicht (/print)")
    .option("--file <path>", "homepage: home.json fuer Entwurfs-Vorschau (statt Live)")
    .option("--frontend-base <url>", "Frontend-Basis ueberschreiben (z.B. http://localhost:5173)")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, arg: string | undefined, opts: VerifyOpts) => {
      const state = loadState();
      const client = createClient(state);
      const fb = frontendBase(state.environment, opts.frontendBase);

      switch (action) {
        case "url": {
          if (!arg) throw new Error("verify url <url> benoetigt eine URL.");
          await renderAndOutput(arg, "url", opts);
          break;
        }

        case "event": {
          if (!arg) throw new Error("verify event <event-id> benoetigt eine Event-ID.");
          const clubId = requireClubId(state, opts.club);
          let path = `/club/${clubId}/event/${arg}/public`;
          if (opts.child) path += `/${opts.child}`;
          if (opts.area) path += `/area/${opts.area}`;
          let url = `${fb}${path}`;
          if (opts.token) url += `?token=${encodeURIComponent(opts.token)}`;
          await renderAndOutput(url, `event-${arg}`, opts);
          break;
        }

        case "menu": {
          if (!arg) throw new Error("verify menu <menu-id> benoetigt eine Menu-ID.");
          const clubId = requireClubId(state, opts.club);
          const url = `${fb}/clubs/${clubId}/menu/${arg}${opts.print ? "/print" : ""}`;
          await renderAndOutput(url, `menu-${arg}`, opts);
          break;
        }

        case "homepage": {
          const clubId = requireClubId(state, opts.club);
          if (opts.file) {
            // Draft preview: POST composed structure → preview_url (no live mutation).
            const struct = readJsonFile<{ tabs?: unknown[] } | unknown[]>(opts.file);
            const tabs = Array.isArray(struct) ? struct : (struct.tabs ?? []);
            if (!Array.isArray(tabs) || tabs.length === 0) {
              throw new Error("home.json braucht mindestens einen Tab (tabs[]).");
            }
            const res = await client.post<{ preview_url?: string }>(
              "club",
              `/home-config/${clubId}/preview`,
              { tabs },
            );
            if (!res.preview_url) throw new Error("Keine preview_url vom club-service erhalten.");
            await renderAndOutput(res.preview_url, "homepage-preview", opts);
            break;
          }
          // Live homepage: resolve the club slug → {slug}.web.comvenio.app.
          const club = await client.get<Record<string, unknown>>("club", `/clubs/${clubId}`);
          const slug =
            (club.slug as string) ?? (club.handle as string) ?? (club.public_slug as string);
          if (!slug) {
            throw new Error(
              "Club hat keinen Homepage-Slug. Erst `comvenio homepage apply` ausfuehren bzw. den " +
                "oeffentlichen Slug setzen, oder `verify homepage --file home.json` fuer einen Entwurf nutzen.",
            );
          }
          await renderAndOutput(`https://${slug}.web.comvenio.app`, "homepage", opts);
          break;
        }

        case "news": {
          if (!arg) throw new Error("verify news <news-id> benoetigt eine News-ID.");
          const clubId = requireClubId(state, opts.club);
          await renderAndOutput(`${fb}/club/${clubId}/news/${arg}`, `news-${arg}`, opts);
          break;
        }

        case "certificate": {
          if (!arg) throw new Error("verify certificate <honor-id> benoetigt eine MemberHonor-ID.");
          // No public route → fetch the HTML token-guarded (RBAC manage_honors),
          // write it locally, render the local file.
          const res = await client.post<{ certificate_html?: string }>(
            "member",
            `/honors/${arg}/generate-certificate`,
            {},
          );
          if (!res.certificate_html) {
            throw new Error("Keine certificate_html vom member-service erhalten.");
          }
          const outDir = opts.out ?? OUT_DIR;
          mkdirSync(outDir, { recursive: true });
          const htmlFile = resolve(`${outDir}/certificate-${arg}.html`);
          writeFileSync(htmlFile, res.certificate_html, "utf8");
          await renderAndOutput(pathToFileURL(htmlFile).href, `certificate-${arg}`, opts, {
            source_html: htmlFile,
          });
          break;
        }

        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: url, event, menu, homepage, news, certificate`,
          );
      }
    });
}
