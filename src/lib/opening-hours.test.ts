import { describe, expect, it } from "vitest";
import { formatDay, krakowClock, openStatus, type WeekHours } from "./opening-hours";

// Typical branch: long Mon/Wed/Fri, short Tue/Thu, closed weekends.
const WEEK: WeekHours = ["12:00-19:00", "08:30-15:30", "12:00-19:00", "12:00-15:30", "12:00-19:00", null, null];

// 2026-10-05 is a Monday; October is CEST (UTC+2).
const at = (iso: string) => new Date(`${iso}+02:00`);

describe("openStatus", () => {
  it("is open during the day's hours", () => {
    expect(openStatus(WEEK, at("2026-10-05T13:00"))).toMatchObject({
      open: true,
      closingSoon: false,
      label: "otwarte do 19:00",
      today: "12:00–19:00",
    });
  });

  it("flags the last hour", () => {
    expect(openStatus(WEEK, at("2026-10-05T18:15")).closingSoon).toBe(true);
  });

  it("says when it opens later today", () => {
    expect(openStatus(WEEK, at("2026-10-05T09:00")).label).toBe(
      "zamknięte · otwiera dziś o 12:00"
    );
  });

  it("says it opens tomorrow after closing", () => {
    expect(openStatus(WEEK, at("2026-10-05T19:00")).label).toBe(
      "zamknięte · otwiera jutro o 8:30"
    );
  });

  it("skips the weekend", () => {
    expect(openStatus(WEEK, at("2026-10-10T10:00")).label).toBe(
      "zamknięte · otwiera pon. o 12:00"
    );
  });

  it("uses Kraków time, not the machine's", () => {
    // 11:30 UTC = 13:30 in Kraków.
    expect(krakowClock(new Date("2026-10-05T11:30:00Z"))).toEqual({ day: 0, minutes: 810 });
  });
});

describe("formatDay", () => {
  it("formats hours and closed days", () => {
    expect(formatDay("08:30-15:30")).toBe("8:30–15:30");
    expect(formatDay(null)).toBe("nieczynne");
  });
});
