/** Wall clock, ticking on the minute rather than the second. */
export function createClock() {
  let now = $state(new Date());
  let timer: ReturnType<typeof setTimeout>;

  const schedule = () => {
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    timer = setTimeout(() => {
      now = new Date();
      schedule();
    }, msToNextMinute);
  };
  schedule();

  return {
    get now() {
      return now;
    },
    stop: () => clearTimeout(timer),
  };
}

export function timeOfDay(date: Date): "morning" | "afternoon" | "evening" {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
