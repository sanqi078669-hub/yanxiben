export function localDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function schedule(
  current: { stage_index: number; success_streak: number },
  rating: string,
  day: string,
  intervals = [1, 3, 7, 14, 30, 60],
) {
  const stage_index =
    rating === "AGAIN"
      ? 0
      : rating === "HARD"
        ? Math.max(0, current.stage_index - 1)
        : Math.min(
            intervals.length - 1,
            current.stage_index + (rating === "EASY" ? 2 : 1),
          );
  const success_streak = ["GOOD", "EASY"].includes(rating)
    ? current.success_streak + 1
    : 0;
  const next = new Date(day + "T12:00:00Z");
  next.setUTCDate(
    next.getUTCDate() + (rating === "AGAIN" ? 1 : intervals[stage_index]),
  );
  return {
    stage_index,
    success_streak,
    due_on: next.toISOString().slice(0, 10),
    stage: activeStage({ stage_index, success_streak }),
  };
}
export function activeStage(current: {
  stage_index: number;
  success_streak: number;
}) {
  return current.stage_index < 0
    ? "NEW"
    : current.success_streak >= 3 && current.stage_index >= 3
      ? "MAINTENANCE"
      : "LEARNING";
}
