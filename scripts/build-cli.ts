// Compiles the standalone `comvenio` binary with a build stamp "<date>.<commit>".
import { spawnSync } from "node:child_process";

function commit(): string {
  const result = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : "unknown";
}

export function buildStamp(now: Date, sha: string): string {
  return `${now.toISOString().slice(0, 10)}.${sha}`;
}

if (import.meta.main) {
  const stamp = buildStamp(new Date(), commit());
  const result = spawnSync("bun", ["build", "src/index.ts", "--compile", "--outfile", "comvenio",
    "--define", `COMVENIO_BUILD=${JSON.stringify(stamp)}`], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
