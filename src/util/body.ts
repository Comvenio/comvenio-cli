// Body-builder helpers shared by the domain commands.
// `prune` drops undefined/null entries so a PATCH/POST body only carries the
// flags the caller actually set (Flush-on-Submit; Sub-File 04 § 3.4).

/** Drop keys whose value is undefined or null (partial-update body builder). */
export function prune<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<T>;
}
