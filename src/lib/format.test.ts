import { describe, expect, it } from "vitest";
import { cleanTitle, subtitleOf } from "./format";

describe("subtitleOf", () => {
  it.each([
    ["Jak zdobyć przyjaciół i zjednać sobie ludzi : dla nastolatek / Donna Dale Carnegie", "dla nastolatek"],
    ["Lalka : powieść. [Książka] / Bolesław Prus", "powieść"],
    ["Diuna / Frank Herbert", ""],
  ])("%s -> %s", (title, subtitle) => {
    expect(subtitleOf(title)).toBe(subtitle);
  });

  it("is what cleanTitle drops", () => {
    const title = "Jak zdobyć przyjaciół i zjednać sobie ludzi : dla nastolatek / D. Carnegie";
    expect(cleanTitle(title)).toBe("Jak zdobyć przyjaciół i zjednać sobie ludzi");
  });
});
