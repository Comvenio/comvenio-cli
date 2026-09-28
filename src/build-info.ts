// Build stamp for `comvenio --version`: `bun run build` injects date and commit
// (scripts/build-cli.ts), so an outdated binary is recognisable; a source run shows "+dev".
declare const COMVENIO_BUILD: string | undefined;

export function cliVersion(base: string, build: string | undefined = typeof COMVENIO_BUILD === "string" ? COMVENIO_BUILD : undefined): string {
  return `${base}+${build && build.trim() ? build.trim() : "dev"}`;
}
