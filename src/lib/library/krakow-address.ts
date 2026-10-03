/**
 * Kraków address handling for geocoding: turns what people type
 * ("ul. Floriańska 3", "al. Mickiewicza 30/2, 30-059 Kraków", "św. Filipa 17")
 * into queries that Nominatim-style geocoders (LocationIQ, Nominatim) match
 * well, and picks the right result instead of blindly taking the first one.
 *
 * Pure functions only — no network — so it is unit-tested offline
 * (see krakow-address.test.ts).
 */

/** Kraków city limits (slightly padded). */
export const KRAKOW_BBOX = {
  minLat: 49.967,
  maxLat: 50.126,
  minLon: 19.792,
  maxLon: 20.217,
} as const;

/** "left,top,right,bottom" (lon/lat) as the `viewbox` parameter expects. */
export const KRAKOW_VIEWBOX = `${KRAKOW_BBOX.minLon},${KRAKOW_BBOX.maxLat},${KRAKOW_BBOX.maxLon},${KRAKOW_BBOX.minLat}`;

export function isInKrakowBbox(lat: number, lon: number): boolean {
  return (
    lat >= KRAKOW_BBOX.minLat &&
    lat <= KRAKOW_BBOX.maxLat &&
    lon >= KRAKOW_BBOX.minLon &&
    lon <= KRAKOW_BBOX.maxLon
  );
}

/**
 * Abbreviations expanded to the words OpenStreetMap uses in street names.
 * Expanding beats deleting: "al. Pokoju" -> "aleja Pokoju" still matches
 * "aleja Pokoju", while "Pokoju" alone also matches unrelated places.
 * "ul." is the exception: OSM street names never contain "ulica".
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/^ul\.?$/i, ""],
  [/^al\.?$/i, "aleja"],
  [/^aleje$/i, "aleja"],
  [/^pl\.?$/i, "plac"],
  [/^os\.?$/i, "osiedle"],
  [/^św\.?$/i, "Świętego"],
  [/^sw\.$/i, "Świętego"],
  [/^gen\.?$/i, "Generała"],
  [/^ks\.?$/i, "Księdza"],
  [/^bp\.?$/i, "Biskupa"],
  [/^abp\.?$/i, "Arcybiskupa"],
  [/^kard\.?$/i, "Kardynała"],
  [/^prof\.?$/i, "Profesora"],
  [/^dr\.?$/i, "Doktora"],
  [/^płk\.?$/i, "Pułkownika"],
  [/^marsz\.?$/i, "Marszałka"],
];

const HOUSE_NUMBER = String.raw`\d+[a-zA-Z]?(?:\s*-\s*\d+[a-zA-Z]?)?`;

export interface ParsedAddress {
  /** Street / square / estate name with abbreviations expanded, e.g. "aleja Mickiewicza". */
  street: string;
  /** Building number without the flat, e.g. "30" from "30/2"; null if none. */
  houseNumber: string | null;
  /** The cleaned input, used for free-form searches. */
  text: string;
}

/** Normalizes user input; returns null when nothing usable is left. */
export function parseKrakowAddress(input: string): ParsedAddress | null {
  let text = input
    .replace(/\b\d{2}-\d{3}\b/g, " ") // postal code
    .replace(/\b(krak[oó]w|polska|poland|ma[lł]opolskie)\b/gi, " ")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Flats: "30/2", "30 m. 2", "30 lok. 5" -> building "30".
  text = text
    .replace(new RegExp(`(${HOUSE_NUMBER})\\s*(?:\\/|\\bm\\.?|\\blok\\.?|\\blokal)\\s*\\d+[a-zA-Z]?\\b`, "g"), "$1")
    .trim();

  // Expand abbreviations token by token ("al." -> "aleja", "ul." -> "").
  text = text
    .split(" ")
    .map((token) => {
      for (const [pattern, replacement] of ABBREVIATIONS) {
        if (pattern.test(token)) return replacement;
      }
      // "al.Mickiewicza" (no space after the dot).
      const glued = /^(ul|al|pl|os|św)\.(.+)$/i.exec(token);
      if (glued) {
        const expanded = ABBREVIATIONS.find(([p]) => p.test(`${glued[1]}.`));
        return `${expanded?.[1] ?? ""} ${glued[2]}`.trim();
      }
      return token;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  // "Floriańska 3", "aleja 3 Maja 1" (number at the end)…
  const trailing = new RegExp(`^(.*[^\\d\\s].*?)\\s+(${HOUSE_NUMBER})$`).exec(text);
  if (trailing) {
    return { street: trailing[1].trim(), houseNumber: compactNumber(trailing[2]), text };
  }
  // …or "3 Floriańska" (number first).
  const leading = new RegExp(`^(${HOUSE_NUMBER})\\s+(\\D.*)$`).exec(text);
  // …but "29 Listopada" / "3 Maja" are street names (dates), not numbers.
  if (leading && !MONTHS.test(normalizeForMatch(leading[2]))) {
    return { street: leading[2].trim(), houseNumber: compactNumber(leading[1]), text };
  }
  return { street: text, houseNumber: null, text };
}

const MONTHS =
  /^(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia)\b/;

function compactNumber(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** Lowercase, no Polish diacritics, no punctuation. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Generic words that may or may not appear in OSM names. */
const STOPWORDS = new Set([
  "ulica", "ul", "aleja", "aleje", "al", "plac", "pl", "osiedle", "os",
  "rondo", "swietego", "swietej", "sw", "generala", "gen", "ksiedza", "ks",
  "biskupa", "bp", "arcybiskupa", "abp", "kardynala", "kard", "profesora",
  "prof", "doktora", "dr", "pulkownika", "plk", "marszalka", "marsz", "im",
  "imienia",
]);

function significantTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .filter((token) => token && !STOPWORDS.has(token));
}

/**
 * True when every meaningful word of the typed street appears in the
 * candidate name: "Mickiewicza" ~ "aleja Adama Mickiewicza",
 * "św. Filipa" ~ "Świętego Filipa", "Lema" ~ "Stanisława Lema".
 */
export function streetMatches(typed: string, candidate: string): boolean {
  const wanted = significantTokens(typed);
  if (wanted.length === 0) return false;
  const have = significantTokens(candidate);
  return wanted.every((word) =>
    have.some((token) => token === word || (word.length >= 4 && token.startsWith(word)))
  );
}

/** One result of a Nominatim-compatible /search call with addressdetails=1. */
export interface GeocoderResult {
  lat: string | number;
  lon: string | number;
  display_name?: string;
  importance?: number;
  class?: string;
  type?: string;
  address?: Record<string, string | undefined>;
}

/** Address fields that can hold the "street" of a Polish address. */
const STREET_FIELDS = [
  "road", "pedestrian", "footway", "square", "place", "residential",
  "neighbourhood", "quarter", "suburb", "hamlet", "city_block",
];

export type Precision = "address" | "street" | "place";

export interface PickedResult {
  lat: number;
  lon: number;
  precision: Precision;
  label: string;
}

function isKrakow(result: GeocoderResult, lat: number, lon: number): boolean {
  if (!isInKrakowBbox(lat, lon)) return false;
  const address = result.address;
  if (!address) return true; // no details: the bounding box has to do
  const city = address.city ?? address.town ?? address.municipality ?? address.county ?? "";
  // Places just outside the city (Zabierzów, Wieliczka) are inside the bbox.
  return city === "" || normalizeForMatch(city) === "krakow";
}

function houseNumberMatches(wanted: string, actual: string | undefined): boolean {
  if (!actual) return false;
  return actual
    .toLowerCase()
    .split(/[;,]/)
    .some((part) => {
      const value = part.replace(/\s+/g, "");
      if (value === wanted) return true;
      const range = /^(\d+)-(\d+)$/.exec(value); // "30-32"
      const n = Number.parseInt(wanted, 10);
      return range ? n >= Number(range[1]) && n <= Number(range[2]) : false;
    });
}

/**
 * Chooses the best result for a parsed address, or null when none is
 * trustworthy:
 *  - results outside Kraków are always rejected (other cities, countries);
 *  - with a house number, the street must match (otherwise null, so the
 *    caller can try a different query rather than accept a random place);
 *  - matching house number > matching street > importance.
 */
export function pickBestResult(
  parsed: ParsedAddress,
  results: GeocoderResult[]
): PickedResult | null {
  let best: { score: number; picked: PickedResult } | null = null;

  for (const result of results) {
    const lat = Number.parseFloat(String(result.lat));
    const lon = Number.parseFloat(String(result.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!isKrakow(result, lat, lon)) continue;

    const address = result.address ?? {};
    const names = [
      ...STREET_FIELDS.map((field) => address[field]),
      // POIs and streets themselves carry the name in display_name.
      result.display_name?.split(",")[0],
    ].filter((name): name is string => Boolean(name));
    const street = names.some((name) => streetMatches(parsed.street, name));
    const number = parsed.houseNumber
      ? houseNumberMatches(parsed.houseNumber, address.house_number)
      : false;

    if (parsed.houseNumber && !street) continue;

    const score =
      (number ? 100 : 0) + (street ? 50 : 0) + (result.importance ?? 0) * 10;
    if (!best || score > best.score) {
      best = {
        score,
        picked: {
          lat,
          lon,
          precision: number ? "address" : street ? "street" : "place",
          label: result.display_name ?? parsed.text,
        },
      };
    }
  }

  return best?.picked ?? null;
}

export type SearchParams = Record<string, string>;

/**
 * The queries to try, in order. Structured search ("street=3 Floriańska,
 * city=Kraków") is the most precise for street addresses; free-form text
 * works better for landmarks ("Dworzec Główny"); the last resort is the
 * street without the number.
 */
export function buildSearchAttempts(parsed: ParsedAddress): SearchParams[] {
  const structured = (street: string): SearchParams => ({
    street,
    city: "Kraków",
    country: "Polska",
  });
  const freeForm = (q: string): SearchParams => ({ q: `${q}, Kraków` });

  if (parsed.houseNumber) {
    return [
      structured(`${parsed.houseNumber} ${parsed.street}`),
      freeForm(`${parsed.street} ${parsed.houseNumber}`),
      structured(parsed.street),
    ];
  }
  return [freeForm(parsed.text), structured(parsed.street)];
}

/** Parameters added to every search (both LocationIQ and Nominatim accept them). */
export const COMMON_SEARCH_PARAMS: SearchParams = {
  format: "json",
  addressdetails: "1",
  limit: "10",
  countrycodes: "pl",
  viewbox: KRAKOW_VIEWBOX,
  bounded: "1",
  "accept-language": "pl",
};
