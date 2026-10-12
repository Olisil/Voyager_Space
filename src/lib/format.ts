/** "1 Sep 2026, 12:00 UTC" */
export const fmtDate = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** A flight time: minutes, hours, days or years. */
export const fmtDur = (s: number) => {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 2 * 86400) return `${(s / 3600).toFixed(1)} h`;
  if (s < 365 * 86400) return `${Math.round(s / 86400)} days`;
  return `${(s / 86400 / 365.25).toFixed(1)} years`;
};

/** Video time, "0:03.2" */
export const fmtClock = (s: number) => {
  const tenths = Math.round(Math.max(0, s) * 10);
  const m = Math.floor(tenths / 600);
  const rest = (tenths - m * 600) / 10;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
};

/** Video times are set to a tenth of a second. */
export const tenth = (s: number) => Math.round(s * 10) / 10;
