import { describe, expect, it } from "vitest";
import {
  buildSearchAttempts,
  type GeocoderResult,
  isInKrakowBbox,
  parseKrakowAddress,
  pickBestResult,
  streetMatches,
} from "./krakow-address";

describe("parseKrakowAddress", () => {
  it.each([
    ["Floriańska 3", "Floriańska", "3"],
    ["ul. Floriańska 3", "Floriańska", "3"],
    ["ul Floriańska 3", "Floriańska", "3"],
    ["UL. FLORIAŃSKA 3", "FLORIAŃSKA", "3"],
    ["Floriańska 3, Kraków", "Floriańska", "3"],
    ["Floriańska 3, 31-019 Kraków, Polska", "Floriańska", "3"],
    ["al. Mickiewicza 30", "aleja Mickiewicza", "30"],
    ["Al Mickiewicza 30", "aleja Mickiewicza", "30"],
    ["Aleje Mickiewicza 30", "aleja Mickiewicza", "30"],
    ["al.Mickiewicza 30", "aleja Mickiewicza", "30"],
    ["al. 3 Maja 1", "aleja 3 Maja", "1"],
    ["al. 29 Listopada 130", "aleja 29 Listopada", "130"],
    ["pl. Szczepański 2", "plac Szczepański", "2"],
    ["os. Centrum A 1", "osiedle Centrum A", "1"],
    ["św. Filipa 17", "Świętego Filipa", "17"],
    ["ul. gen. Bora-Komorowskiego 37", "Generała Bora-Komorowskiego", "37"],
    ["Karmelicka 6/2", "Karmelicka", "6"],
    ["Karmelicka 6 m. 2", "Karmelicka", "6"],
    ["Karmelicka 6 lok. 12", "Karmelicka", "6"],
    ["Długa 12A", "Długa", "12a"],
    ["Jana Pawła II 41", "Jana Pawła II", "41"],
    ["Mogilska 40-42", "Mogilska", "40-42"],
    ["3 Floriańska", "Floriańska", "3"],
  ])("%s -> street %s, number %s", (input, street, number) => {
    const parsed = parseKrakowAddress(input);
    expect(parsed?.street).toBe(street);
    expect(parsed?.houseNumber).toBe(number);
  });

  it.each([
    ["Dworzec Główny", "Dworzec Główny"],
    ["al. 3 Maja", "aleja 3 Maja"],
    ["29 Listopada", "29 Listopada"],
    ["Rynek Główny", "Rynek Główny"],
    ["Plac Centralny", "Plac Centralny"],
  ])("%s has no house number", (input, street) => {
    const parsed = parseKrakowAddress(input);
    expect(parsed?.street).toBe(street);
    expect(parsed?.houseNumber).toBeNull();
  });

  it("does not mangle words that only start like abbreviations", () => {
    expect(parseKrakowAddress("Plac Wolności 1")?.street).toBe("Plac Wolności");
    expect(parseKrakowAddress("Albertyńska 5")?.street).toBe("Albertyńska");
    expect(parseKrakowAddress("Ulanowskiego 2")?.street).toBe("Ulanowskiego");
    expect(parseKrakowAddress("Osiedle Złotego Wieku 1")?.street).toBe("Osiedle Złotego Wieku");
  });

  it("returns null for empty input", () => {
    expect(parseKrakowAddress("  , Kraków ")).toBeNull();
  });
});

describe("streetMatches", () => {
  it.each([
    ["aleja Mickiewicza", "aleja Adama Mickiewicza"],
    ["Mickiewicza", "aleja Adama Mickiewicza"],
    ["Świętego Filipa", "Świętego Filipa"],
    ["Filipa", "św. Filipa"],
    ["Lema", "Stanisława Lema"],
    ["Florianska", "Floriańska"],
    ["Jana Pawła II", "aleja Jana Pawła II"],
    ["osiedle Centrum A", "Osiedle Centrum A"],
    ["aleja 3 Maja", "aleja 3 Maja"],
  ])("%s matches %s", (typed, osm) => {
    expect(streetMatches(typed, osm)).toBe(true);
  });

  it.each([
    ["Floriańska", "Szpitalna"],
    ["aleja 3 Maja", "aleja 29 Listopada"],
    ["Długa", "Krótka"],
    ["aleja", "aleja Adama Mickiewicza"], // only generic words typed
  ])("%s does not match %s", (typed, osm) => {
    expect(streetMatches(typed, osm)).toBe(false);
  });
});

describe("isInKrakowBbox", () => {
  it("accepts Kraków and rejects other cities", () => {
    expect(isInKrakowBbox(50.0617, 19.9373)).toBe(true); // Rynek Główny
    expect(isInKrakowBbox(50.0718, 20.0379)).toBe(true); // Nowa Huta
    expect(isInKrakowBbox(52.2297, 21.0122)).toBe(false); // Warszawa
    expect(isInKrakowBbox(50.0, 20.4)).toBe(false); // east of Kraków
    expect(isInKrakowBbox(41.9, -87.6)).toBe(false); // Chicago (has a "Krakow")
  });
});

const result = (
  lat: number,
  lon: number,
  address: Record<string, string>,
  extra: Partial<GeocoderResult> = {}
): GeocoderResult => ({ lat: String(lat), lon: String(lon), address, ...extra });

describe("pickBestResult", () => {
  const floriańska = parseKrakowAddress("ul. Floriańska 3")!;

  it("rejects results from other countries and cities", () => {
    const picked = pickBestResult(floriańska, [
      result(41.88, -87.63, { road: "Floriańska", house_number: "3", city: "Chicago" }),
      result(50.29, 18.67, { road: "Floriańska", house_number: "3", city: "Gliwice" }),
    ]);
    expect(picked).toBeNull();
  });

  it("rejects a place in the bbox that is not Kraków", () => {
    const picked = pickBestResult(floriańska, [
      result(50.0, 20.05, { road: "Floriańska", house_number: "3", town: "Wieliczka" }),
    ]);
    expect(picked).toBeNull();
  });

  it("prefers the exact house number over a higher-ranked first result", () => {
    const picked = pickBestResult(floriańska, [
      result(50.0640, 19.9405, { road: "Floriańska", city: "Kraków" }, { importance: 0.9 }),
      result(50.0627, 19.9393, { road: "Floriańska", house_number: "3", city: "Kraków" }, { importance: 0.2 }),
    ]);
    expect(picked).toMatchObject({ lat: 50.0627, lon: 19.9393, precision: "address" });
  });

  it("rejects a numbered address on the wrong street (so the next query runs)", () => {
    const picked = pickBestResult(floriańska, [
      result(50.0631, 19.9418, { road: "Szpitalna", house_number: "3", city: "Kraków" }),
    ]);
    expect(picked).toBeNull();
  });

  it("falls back to the street when the number is missing in OSM", () => {
    const picked = pickBestResult(floriańska, [
      result(50.0635, 19.9398, { road: "Floriańska", city: "Kraków" }),
    ]);
    expect(picked?.precision).toBe("street");
  });

  it("matches 'al. Mickiewicza' against OSM 'aleja Adama Mickiewicza'", () => {
    const parsed = parseKrakowAddress("al. Mickiewicza 30")!;
    const picked = pickBestResult(parsed, [
      result(50.0657, 19.9189, { road: "aleja Adama Mickiewicza", house_number: "30", city: "Kraków" }),
    ]);
    expect(picked?.precision).toBe("address");
  });

  it("accepts a landmark by name", () => {
    const parsed = parseKrakowAddress("Dworzec Główny")!;
    const picked = pickBestResult(parsed, [
      result(50.0675, 19.9476, { railway: "Kraków Główny", city: "Kraków" }, {
        display_name: "Kraków Główny, Pawia, Kraków, Polska",
        importance: 0.5,
      }),
    ]);
    expect(picked?.precision).toBe("place");
  });

  it("matches house number ranges like '40-42'", () => {
    const parsed = parseKrakowAddress("Mogilska 41")!;
    const picked = pickBestResult(parsed, [
      result(50.066, 19.962, { road: "Mogilska", house_number: "40-42", city: "Kraków" }),
    ]);
    expect(picked?.precision).toBe("address");
  });
});

describe("buildSearchAttempts", () => {
  it("tries structured, then free-form, then street-only for addresses", () => {
    const attempts = buildSearchAttempts(parseKrakowAddress("al. Mickiewicza 30")!);
    expect(attempts).toEqual([
      { street: "30 aleja Mickiewicza", city: "Kraków", country: "Polska" },
      { q: "aleja Mickiewicza 30, Kraków" },
      { street: "aleja Mickiewicza", city: "Kraków", country: "Polska" },
    ]);
  });

  it("tries free-form first for landmarks", () => {
    const attempts = buildSearchAttempts(parseKrakowAddress("Dworzec Główny")!);
    expect(attempts[0]).toEqual({ q: "Dworzec Główny, Kraków" });
  });
});
