import { localDate } from "../modules/review/schedule";

export function statisticsDates(timezone: string, now = new Date()) {
  const to = localDate(timezone, now);
  const start = new Date(to + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - 30);
  return { from: start.toISOString().slice(0, 10), to };
}
