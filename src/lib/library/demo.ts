/**
 * Demo data source: lets the whole UI work without the live catalog
 * (e.g. when scraping is blocked) and without a LocationIQ API key.
 *
 * Availability is generated deterministically from the title, so the same
 * search always gives the same result.
 */

import type { RawBook, SearchField } from "./types";

const DEMO_BOOKS: { title: string; author: string; tags?: string }[] = [
  { title: "Diuna / Frank Herbert", author: "Herbert, Frank (1920-1986)." },
  // Real catalog searches return one record per edition, so include a few
  // editions of the same book to exercise the merging in the UI.
  { title: "Diuna / Frank Herbert ; przełożył Marek Marszał.", author: "Herbert, Frank (1920-1986). Autor" },
  { title: "Diuna : powieść / Frank Herbert", author: "Herbert, Frank (1920-1986)." },
  { title: "Lalka : powieść. [Książka] / Bolesław Prus", author: "Prus, Bolesław (1847-1912). Autor" },
  { title: "Mesjasz Diuny / Frank Herbert", author: "Herbert, Frank (1920-1986)." },
  { title: "Dzieci Diuny / Frank Herbert", author: "Herbert, Frank (1920-1986)." },
  { title: "Ostatnie życzenie / Andrzej Sapkowski", author: "Sapkowski, Andrzej (1948- ).", tags: "Wiedźmin" },
  { title: "Miecz przeznaczenia / Andrzej Sapkowski", author: "Sapkowski, Andrzej (1948- ).", tags: "Wiedźmin" },
  { title: "Krew elfów / Andrzej Sapkowski", author: "Sapkowski, Andrzej (1948- ).", tags: "Wiedźmin" },
  { title: "Lalka / Bolesław Prus", author: "Prus, Bolesław (1847-1912)." },
  { title: "Faraon / Bolesław Prus", author: "Prus, Bolesław (1847-1912)." },
  { title: "Hobbit, czyli Tam i z powrotem / J.R.R. Tolkien", author: "Tolkien, J. R. R. (1892-1973)." },
  { title: "Władca Pierścieni. Drużyna Pierścienia / J.R.R. Tolkien", author: "Tolkien, J. R. R. (1892-1973)." },
  { title: "Bieguni / Olga Tokarczuk", author: "Tokarczuk, Olga (1962- )." },
  { title: "Prowadź swój pług przez kości umarłych / Olga Tokarczuk", author: "Tokarczuk, Olga (1962- )." },
  { title: "Księgi Jakubowe / Olga Tokarczuk", author: "Tokarczuk, Olga (1962- )." },
  { title: "Solaris / Stanisław Lem", author: "Lem, Stanisław (1921-2006)." },
  { title: "Cyberiada / Stanisław Lem", author: "Lem, Stanisław (1921-2006)." },
  { title: "Pan Tadeusz / Adam Mickiewicz", author: "Mickiewicz, Adam (1798-1855)." },
  { title: "Harry Potter i Kamień Filozoficzny / J.K. Rowling", author: "Rowling, J. K. (1965- )." },
  { title: "Rok 1984 / George Orwell", author: "Orwell, George (1903-1950)." },
  { title: "Mały Książę / Antoine de Saint-Exupéry", author: "Saint-Exupéry, Antoine de (1900-1944)." },
  { title: "Zbrodnia i kara / Fiodor Dostojewski", author: "Dostojewski, Fiodor (1821-1881)." },
];

/** Known Kraków places for geocoding without an API key. */
const DEMO_PLACES: { names: string[]; lat: number; lon: number }[] = [
  { names: ["rynek", "stare miasto", "sukiennice", "floriańska"], lat: 50.0617, lon: 19.9373 },
  { names: ["wawel"], lat: 50.0541, lon: 19.9354 },
  { names: ["kazimierz", "szeroka", "józefa"], lat: 50.0513, lon: 19.9449 },
  { names: ["podgórze", "rynek podgórski", "zabłocie"], lat: 50.0437, lon: 19.9576 },
  { names: ["bronowice"], lat: 50.0811, lon: 19.8853 },
  { names: ["nowa huta", "plac centralny"], lat: 50.0716, lon: 20.0379 },
  { names: ["krowodrza", "czarnowiejska", "agh"], lat: 50.0681, lon: 19.9179 },
  { names: ["kleparz", "dworzec", "galeria krakowska"], lat: 50.0677, lon: 19.9449 },
  { names: ["grzegórzki", "rondo mogilskie"], lat: 50.0626, lon: 19.9594 },
  { names: ["prądnik", "azory"], lat: 50.0909, lon: 19.9259 },
  { names: ["łagiewniki"], lat: 50.0198, lon: 19.9339 },
  { names: ["ruczaj", "kampus uj"], lat: 50.0271, lon: 19.9036 },
  { names: ["salwator", "zwierzyniec", "błonia"], lat: 50.0547, lon: 19.9057 },
  { names: ["bieżanów", "prokocim"], lat: 50.0129, lon: 20.0157 },
];

/** Centre of Kraków, used when a demo address is unknown. */
export const DEMO_FALLBACK = { lat: 50.0617, lon: 19.9373 };

/** Lowercases and strips Polish diacritics for forgiving matching. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Small deterministic PRNG (mulberry32) seeded from a string hash. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Searches the built-in demo catalog; copies are spread over real branches. */
export function demoSearchBooks(
  query: string,
  branchNumbers: number[],
  catalogBaseUrl: string,
  field: SearchField = "any"
): RawBook[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0 || branchNumbers.length === 0) return [];

  const matches = DEMO_BOOKS.filter((book) => {
    const haystack = normalize(
      field === "title"
        ? `${book.title.split(" / ")[0]} ${book.tags ?? ""}`
        : field === "author"
          ? book.author
          : `${book.title} ${book.author} ${book.tags ?? ""}`
    );
    return words.every((word) => haystack.includes(word));
  });

  return matches.flatMap((book) => {
    const random = seededRandom(book.title);
    const copies = 2 + Math.floor(random() * 9); // 2–10 branches
    const pool = [...branchNumbers];
    const picked: number[] = [];
    while (picked.length < copies && pool.length > 0) {
      picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    // Demo records have no real id, so link to a catalog search for the title.
    const params = new URLSearchParams({
      KatID: "0",
      typ: "repl",
      plnk: `q__${book.title.split(" / ")[0]}`,
      sort: "byscore",
      forigin: "krakow_biblioteka_ks",
      flang: "pol",
    });
    const record_url = `${catalogBaseUrl}?${params}`;
    return picked.map((branch_number) => ({
      title: book.title,
      author: book.author,
      branch_number,
      available: random() < 0.45,
      record_url,
    }));
  });
}

/** Geocodes against a few known Kraków places; unknown -> null. */
export function demoGeocode(address: string): { lat: number; lon: number } | null {
  const needle = normalize(address);
  const place = DEMO_PLACES.find((p) =>
    p.names.some((name) => needle.includes(normalize(name)))
  );
  return place ? { lat: place.lat, lon: place.lon } : null;
}
