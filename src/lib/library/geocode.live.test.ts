/**
 * Live geocoding check against the real geocoder (LocationIQ when
 * LOCATIONIQ_API_KEY is set, otherwise Nominatim). Skipped by default
 * because it hits the network and is rate limited; run it with:
 *
 *   npm run test:geocode
 *
 * Every address is verified two ways:
 *  1. distance to a reference point (where one is given), and
 *  2. reverse geocoding the result and checking the street name matches
 *     what was typed — this needs no reference coordinates at all.
 * The printed table has a map link for each result to eyeball doubtful ones.
 *
 * Squares and landmarks (`landmark: true`) skip the reverse check because
 * reverse geocoding returns the nearest road, not the square.
 *
 * Reference points are approximate (landmark entrances / building
 * centres), hence the per-case tolerance.
 */
import { afterAll, describe, expect, it } from "vitest";
import { hasLocationiqKey } from "./config";
import { DistanceCalculator, Coordinates } from "./coordinates";
import { type GeocoderProvider, geocodeKrakow, getGeocoderProvider } from "./geocode";
import { parseKrakowAddress, streetMatches } from "./krakow-address";

interface Case {
  input: string;
  /** Approximate reference point; omit to rely on the reverse check only. */
  expect?: [lat: number, lon: number];
  toleranceM?: number;
  /** Landmarks have no street to compare in the reverse check. */
  landmark?: boolean;
  /** Should NOT be found. */
  notFound?: boolean;
}

const FLORIANSKA_3: [number, number] = [50.0626, 19.9391];
const AGH_A0: [number, number] = [50.0646, 19.9233];
const BAGATELA: [number, number] = [50.064, 19.9332];
const TAURON_ARENA: [number, number] = [50.0676, 19.9917];

const CASES: Case[] = [
  // Same address typed in many ways — all must land in the same place.
  { input: "Floriańska 3", expect: FLORIANSKA_3, toleranceM: 250 },
  { input: "ul. Floriańska 3", expect: FLORIANSKA_3, toleranceM: 250 },
  { input: "ul.Floriańska 3", expect: FLORIANSKA_3, toleranceM: 250 },
  { input: "Florianska 3", expect: FLORIANSKA_3, toleranceM: 250 },
  { input: "FLORIAŃSKA 3, Kraków", expect: FLORIANSKA_3, toleranceM: 250 },
  { input: "Floriańska 3, 31-019 Kraków, Polska", expect: FLORIANSKA_3, toleranceM: 250 },
  // "al." is where stripping broke things: OSM says "aleja Adama Mickiewicza".
  { input: "al. Mickiewicza 30", expect: AGH_A0, toleranceM: 300 },
  { input: "Al Mickiewicza 30", expect: AGH_A0, toleranceM: 300 },
  { input: "Aleja Mickiewicza 30", expect: AGH_A0, toleranceM: 300 },
  { input: "al. Adama Mickiewicza 30", expect: AGH_A0, toleranceM: 300 },
  { input: "Mickiewicza 30", expect: AGH_A0, toleranceM: 300 },
  { input: "al. 3 Maja 1", expect: [50.0604, 19.9236], toleranceM: 300 },
  // Flats and suffixes.
  { input: "Karmelicka 6", expect: BAGATELA, toleranceM: 250 },
  { input: "ul. Karmelicka 6/2", expect: BAGATELA, toleranceM: 250 },
  { input: "Karmelicka 6 m. 2", expect: BAGATELA, toleranceM: 250 },
  // Common street names that exist in many Polish towns.
  { input: "Długa 1", expect: [50.0665, 19.9376], toleranceM: 400 },
  { input: "Kalwaryjska 2" },
  { input: "Józefińska 2", expect: [50.0465, 19.95], toleranceM: 400 },
  { input: "Pawia 5", expect: [50.0673, 19.945], toleranceM: 300 },
  { input: "Wawel 5", expect: [50.054, 19.9352], toleranceM: 300 },
  // Name prefixes.
  { input: "Stanisława Lema 7", expect: TAURON_ARENA, toleranceM: 400 },
  { input: "Lema 7", expect: TAURON_ARENA, toleranceM: 400 },
  { input: "św. Filipa 17" },
  { input: "ul. gen. Bora-Komorowskiego 37" },
  { input: "al. Jana Pawła II 41" },
  { input: "al. 29 Listopada 130" },
  // Nowa Huta "osiedle" addresses have no street.
  { input: "os. Centrum A 1" },
  { input: "os. Złotego Wieku 34" },
  // Squares and landmarks.
  { input: "pl. Szczepański", expect: [50.0643, 19.9344], toleranceM: 250, landmark: true },
  { input: "Plac Centralny", expect: [50.0718, 20.0377], toleranceM: 300, landmark: true },
  { input: "Rynek Główny", expect: [50.0617, 19.9373], toleranceM: 300, landmark: true },
  { input: "Dworzec Główny", expect: [50.0676, 19.9473], toleranceM: 400, landmark: true },
  { input: "Kopiec Kościuszki", expect: [50.0549, 19.8933], toleranceM: 400, landmark: true },
  { input: "Rondo Mogilskie", expect: [50.066, 19.9597], toleranceM: 400, landmark: true },
  // Must not be "found" somewhere random.
  { input: "Nieistniejąca 12345", notFound: true },
];

interface Row {
  input: string;
  ok: string;
  precision: string;
  distanceM: string;
  reverseStreet: string;
  map: string;
}

const rows: Row[] = [];

/** Address fields reverse geocoding may put the street name in. */
const REVERSE_NAME_FIELDS = [
  "road", "pedestrian", "footway", "square", "place", "residential",
  "neighbourhood", "quarter", "suburb", "city_block",
];

/**
 * Street names around the point. Reverse geocoding snaps to the nearest
 * named object, which can be an indoor corridor of a mall ("Antresola"),
 * a footway or a square rather than the street of the address — so all
 * name fields are returned and the check passes if any of them matches.
 */
async function reverseNames(provider: GeocoderProvider, lat: number, lon: number) {
  // Goes through the provider so it shares the rate limit with searches.
  const address = await provider.reverse(lat, lon);
  return REVERSE_NAME_FIELDS.map((field) => address[field]).filter(
    (name): name is string => Boolean(name)
  );
}

describe.skipIf(
  !process.env.GEOCODE_LIVE && process.env.npm_lifecycle_event !== "test:geocode"
)(
  `live Kraków geocoding (${hasLocationiqKey ? "LocationIQ" : "Nominatim"})`,
  () => {
    const provider = getGeocoderProvider();

    it.each(CASES)("$input", async (testCase) => {
      let found: Awaited<ReturnType<typeof geocodeKrakow>>;
      try {
        found = await geocodeKrakow(testCase.input, provider);
      } catch (error) {
        // Rate limit / network / key problem — not a wrong address.
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          input: testCase.input,
          ok: "ERROR",
          precision: message.slice(0, 60),
          distanceM: "-",
          reverseStreet: "-",
          map: "",
        });
        throw error;
      }

      if (testCase.notFound) {
        rows.push({
          input: testCase.input,
          ok: found ? "FAIL" : "ok",
          precision: found?.precision ?? "-",
          distanceM: "-",
          reverseStreet: "-",
          map: found ? `https://www.openstreetmap.org/?mlat=${found.lat}&mlon=${found.lon}#map=18/${found.lat}/${found.lon}` : "",
        });
        // A street-level guess is acceptable, a precise hit is not.
        expect(found?.precision === "address").toBe(false);
        return;
      }

      const row: Row = {
        input: testCase.input,
        ok: "FAIL",
        precision: found?.precision ?? "not found",
        distanceM: "-",
        reverseStreet: "-",
        map: found
          ? `https://www.openstreetmap.org/?mlat=${found.lat}&mlon=${found.lon}#map=18/${found.lat}/${found.lon}`
          : "",
      };
      rows.push(row);
      expect(found, "address not found").not.toBeNull();
      if (!found) return;

      let distanceOk = true;
      if (testCase.expect) {
        const meters =
          DistanceCalculator.haversine(
            new Coordinates(found.lat, found.lon),
            new Coordinates(...testCase.expect)
          ) * 1000;
        row.distanceM = String(Math.round(meters));
        distanceOk = meters <= (testCase.toleranceM ?? 300);
      }

      let streetOk = true;
      if (!testCase.landmark) {
        const names = await reverseNames(provider, found.lat, found.lon);
        row.reverseStreet = names.join(" / ") || "?";
        const typed = parseKrakowAddress(testCase.input)!.street;
        streetOk = names.some((name) => streetMatches(typed, name));
      }

      row.ok = distanceOk && streetOk ? "ok" : !distanceOk ? "FAR" : "STREET?";
      expect(distanceOk, `result ${row.distanceM} m from the reference point`).toBe(true);
      expect(
        streetOk,
        `reverse geocoding found "${row.reverseStreet}" there, not the typed street — open the map link to check`
      ).toBe(true);
    }, 120_000);

    afterAll(() => {
      console.table(rows);
      const failed = rows.filter((r) => r.ok !== "ok").length;
      console.log(`${rows.length - failed}/${rows.length} addresses OK`);
      if (rows.some((r) => r.ok === "ERROR")) {
        console.log(
          "ERROR rows mean the geocoder refused the request (e.g. HTTP 429 rate limit), " +
            "not that the address is wrong. Raise LOCATIONIQ_MIN_INTERVAL_MS and re-run."
        );
      }
    });
  }
);
