/**
 * Convert between <input type="datetime-local"> values (wall clock in the
 * editor's timezone, default Europe/Amsterdam) and UTC Date objects.
 */
export const ADMIN_TZ = process.env.ADMIN_TIMEZONE ?? "Europe/Amsterdam";

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

/** "2026-11-20T09:30" (in timeZone) -> Date */
export function localInputToDate(value: string | null | undefined, timeZone = ADMIN_TZ): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // two passes handle DST transitions
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  ts = guess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Date -> "2026-11-20T09:30" in timeZone */
export function dateToLocalInput(date: Date | null | undefined, timeZone = ADMIN_TZ): string {
  if (!date) return "";
  const local = new Date(date.getTime() + tzOffsetMs(date, timeZone));
  return local.toISOString().slice(0, 16);
}

export function formatDateTime(date: Date | null | undefined, timeZone = ADMIN_TZ): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
