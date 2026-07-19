// Tiny pretty-printers. No table dependency to keep the compiled binary small.

export function truncate(value: unknown, max: number): string {
  const s = value == null ? "" : String(value);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export type Column<T> = {
  header: string;
  width: number;
  get: (row: T) => string;
};

// Simple fixed-width table. Each cell is trimmed to fit its column width.
export function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  const pad = (s: string, w: number) =>
    s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
  const header = columns.map((c) => pad(c.header, c.width)).join("  ");
  const sep = columns.map((c) => "-".repeat(c.width)).join("  ");
  const body = rows
    .map((r) =>
      columns.map((c) => pad(truncate(c.get(r), c.width), c.width)).join("  "),
    )
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

/**
 * Agent-friendly output (D-09): with `--json`, emit ONLY machine-readable JSON
 * to stdout; otherwise call the human-readable text renderer. Errors are
 * written to stderr by the caller (main()), never here — keeps the --json
 * contract clean.
 */
export function output(
  data: unknown,
  json: boolean | undefined,
  text: () => string,
): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(text());
  }
}
