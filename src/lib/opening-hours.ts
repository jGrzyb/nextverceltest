/**
 * "Open now" logic for library branches. Pure functions; the hours live in
 * branch-hours.ts. Times are evaluated in Kraków time (Europe/Warsaw)
 * whatever the viewer's time zone.
 */

/** "08:30-19:00", or null when closed that day. */
export type DayHours = string | null;
/** Monday first: [mon, tue, wed, thu, fri, sat, sun]. */
export type WeekHours = [DayHours, DayHours, DayHours, DayHours, DayHours, DayHours, DayHours];

export interface OpenStatus {
  open: boolean;
  /** Closes within the next hour. */
  closingSoon: boolean;
  /** "otwarte do 19:00", "zamknięte · otwiera jutro o 12:00", … */
  label: string;
  /** Today's hours for display, e.g. "12:00–19:00" or "nieczynne". */
  today: string;
}

const DAY_NAMES = ["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."];
export const DAY_LABELS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"];

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function parseDay(day: DayHours): [open: number, close: number] | null {
  if (!day) return null;
  const [from, to] = day.split("-");
  return [toMinutes(from), toMinutes(to)];
}

/** Strips the leading zero: "08:30" -> "8:30". */
export function formatTime(time: string): string {
  return time.replace(/^0/, "");
}

export function formatDay(day: DayHours): string {
  if (!day) return "nieczynne";
  const [from, to] = day.split("-");
  return `${formatTime(from)}–${formatTime(to)}`;
}

/** Day of week (0 = Monday) and minutes since midnight in Kraków. */
export function krakowClock(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function openStatus(week: WeekHours, now: Date = new Date()): OpenStatus {
  const { day, minutes } = krakowClock(now);
  const today = parseDay(week[day]);
  const todayLabel = formatDay(week[day]);

  if (today && minutes >= today[0] && minutes < today[1]) {
    const closes = week[day]!.split("-")[1];
    return {
      open: true,
      closingSoon: today[1] - minutes <= 60,
      label: `otwarte do ${formatTime(closes)}`,
      today: todayLabel,
    };
  }

  // Next opening: later today, or the next day with hours.
  if (today && minutes < today[0]) {
    return {
      open: false,
      closingSoon: false,
      label: `zamknięte · otwiera dziś o ${formatTime(week[day]!.split("-")[0])}`,
      today: todayLabel,
    };
  }
  for (let offset = 1; offset <= 7; offset++) {
    const next = (day + offset) % 7;
    if (week[next]) {
      const when = offset === 1 ? "jutro" : DAY_NAMES[next];
      return {
        open: false,
        closingSoon: false,
        label: `zamknięte · otwiera ${when} o ${formatTime(week[next]!.split("-")[0])}`,
        today: todayLabel,
      };
    }
  }
  return { open: false, closingSoon: false, label: "zamknięte", today: todayLabel };
}
