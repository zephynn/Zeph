function tzOffsetHours(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = raw.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) / 60 : 0;
  return sign * (hours + minutes);
}

export function describeLocalTime(timeZone: string, date = new Date()): { time: string; offsetLabel: string } {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  const targetOffset = tzOffsetHours(timeZone, date);
  const localOffset = -date.getTimezoneOffset() / 60;
  const diff = targetOffset - localOffset;

  const offsetLabel = diff === 0 ? "same time as you" : `${diff > 0 ? "+" : ""}${diff}h from you`;

  return { time, offsetLabel };
}
