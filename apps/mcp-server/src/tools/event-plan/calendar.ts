import type { JsonValue } from "@comvenio/connector-contracts";

export interface LocalDateRange extends Record<string, JsonValue> {
  from: string;
  to: string;
  timezone: string;
  from_inclusive: true;
  to_exclusive: true;
}

function dateParts(date: Date, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: value }).format(new Date(0));
    return value.includes("/") && !value.startsWith("Etc/");
  } catch {
    return false;
  }
}

export function localDateBoundaryUtc(localDate: string, timezone: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day || !isIanaTimeZone(timezone)) {
    throw new Error("Ungültige lokale Datumsgrenze oder IANA-Zeitzone.");
  }
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = dateParts(new Date(candidate), timezone);
    const represented = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    candidate += desired - represented;
  }
  return new Date(candidate).toISOString();
}

function isoLocalDate(date: Date, timezone: string): string {
  const parts = dateParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function validateLocalDateRange(range: LocalDateRange): LocalDateRange {
  if (!isIanaTimeZone(range.timezone)) throw new Error("Die Zeitzone ist keine freigegebene IANA-Zeitzone.");
  if (range.from >= range.to) throw new Error("Der exklusive Zeitraum-Endtag muss nach dem Starttag liegen.");
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000);
  if (days > 366) throw new Error("Ein Kalenderabruf darf höchstens 366 lokale Tage umfassen.");
  return range;
}

export function rangeQuery(range: LocalDateRange): Record<string, string> {
  validateLocalDateRange(range);
  return {
    start: localDateBoundaryUtc(range.from, range.timezone),
    end: localDateBoundaryUtc(range.to, range.timezone),
  };
}

export function eventDaySegments(
  startTime: string | null,
  endTime: string | null,
  timezone: string,
): JsonValue[] {
  if (!startTime) return [];
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : start;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return [];
  const first = isoLocalDate(start, timezone);
  const last = isoLocalDate(end, timezone);
  const segments: JsonValue[] = [];
  for (let date = first, index = 0; date <= last && index < 367; date = addLocalDays(date, 1), index++) {
    segments.push({
      local_date: date,
      timezone,
      starts_on_day: date === first,
      ends_on_day: date === last,
    });
  }
  return segments;
}
