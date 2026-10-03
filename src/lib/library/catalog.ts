import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { config } from "./config";
import { demoSearchBooks } from "./demo";
import { Coordinates, DistanceCalculator } from "./coordinates";
import { fetchWithRetry } from "./http";
import type { Book, RawBook, SearchField } from "./types";

export type { Book, RawBook };

/**
 * Catalog search syntax: "q__" searches every field; the advanced search
 * uses "__tytul_" / "__autor_" for a single field.
 */
const PLNK_PREFIX: Record<SearchField, string> = {
  any: "q__",
  title: "__tytul_",
  author: "__autor_",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown when the catalog site cannot be reached or responds with an error. */
export class CatalogHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogHttpError";
  }
}

/** Extracts the branch number from a library name like "Filia nr 21". */
function branchNumberFromName(name: string): number | null {
  const match = /\d+/.exec(name);
  return match ? Number.parseInt(match[0], 10) : null;
}

/** Catalog record ids look like "KrB26005984" (MARC field 001). */
const RECORD_ID_IN_HREF = /[?&]001=([^&#"'\s]+)/;
const RECORD_ID_IN_TEXT = /\b(KrB\d{5,})\b/;

/**
 * Finds the catalog record id of a search hit. The id appears in the
 * record's links ("index.php?KatID=0&typ=record&001=KrB26005984"); look in
 * the record element first, then in its wrapper, then anywhere in its HTML.
 */
function findRecordId(
  $: ReturnType<typeof load>,
  record: ReturnType<ReturnType<typeof load>>
): string | null {
  for (const scope of [record, record.parent(), record.parent().parent()]) {
    let id: string | null = null;
    scope.find("a[href*='001=']").each((_, link) => {
      const match = RECORD_ID_IN_HREF.exec($(link).attr("href") ?? "");
      if (match) {
        id = decodeURIComponent(match[1]);
        return false; // stop iterating
      }
    });
    if (id) return id;
  }
  const match = RECORD_ID_IN_TEXT.exec(record.parent().html() ?? "");
  return match ? match[1] : null;
}

/** Minimal RFC-4180-style CSV line parser (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Loads library locations from CSV into a mapping: branch_number -> Coordinates.
 *
 * Supports both CSV layouts:
 *   - "branch_number,lat,lon"  (the "cleaned" file the Python script expected)
 *   - "library name,lat,lon"   (raw export, e.g. "Filia nr 21" — the number
 *                               is extracted from the name)
 */
function loadLibraryCoordinates(filepath: string): Map<number, Coordinates> {
  const resolved = path.isAbsolute(filepath)
    ? filepath
    : path.join(process.cwd(), filepath);

  if (!existsSync(resolved)) {
    throw new Error(
      `CSV file not found: ${resolved}. Place the branch-coordinates CSV ` +
        `at the project root or set the LIBRARY_CSV environment variable.`
    );
  }

  const content = readFileSync(resolved, "utf-8");
  const lines = content.split(/\r?\n/);
  lines.shift(); // skip header

  const coordinates = new Map<number, Coordinates>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row = parseCsvLine(line);
    if (row.length < 3) {
      console.warn(
        `[library] Skipping row ${i + 2} with insufficient columns: ${line}`
      );
      continue;
    }

    // Layout A: the first column is already the branch number.
    // Layout B: the first column is the library name ("Filia nr 21").
    let branchNumber = Number.parseInt(row[0], 10);
    if (Number.isNaN(branchNumber)) {
      branchNumber = branchNumberFromName(row[0]) ?? Number.NaN;
    }

    const lat = Number.parseFloat(row[1]);
    const lon = Number.parseFloat(row[2]);

    if (
      Number.isNaN(branchNumber) ||
      Number.isNaN(lat) ||
      Number.isNaN(lon)
    ) {
      console.warn(`[library] Skipping invalid row ${i + 2}: ${line}`);
      continue;
    }

    coordinates.set(branchNumber, new Coordinates(lat, lon));
  }

  if (coordinates.size === 0) {
    console.warn("[library] No valid library coordinates loaded from CSV");
  } else {
    console.info(
      `[library] Loaded ${coordinates.size} library branch coordinates`
    );
  }

  return coordinates;
}

/**
 * Reusable client for the Kraków library catalog.
 * Instantiate once and reuse across requests (the CSV is loaded only once).
 */
export class LibraryCatalog {
  readonly baseUrl: string;
  private readonly libraryCoordinates: Map<number, Coordinates>;

  constructor(options?: { csvFilepath?: string; baseUrl?: string }) {
    this.baseUrl = options?.baseUrl ?? config.catalogBaseUrl;
    this.libraryCoordinates = loadLibraryCoordinates(
      options?.csvFilepath ?? config.libraryCsv
    );
  }

  /** Public catalog page of one record (edition). */
  recordUrl(recordId: string): string {
    const params = new URLSearchParams({ KatID: "0", typ: "record", "001": recordId });
    return `${this.baseUrl}?${params}`;
  }

  /**
   * Scrapes book availability from the library catalog, following the
   * "next page" link (`#navi-arr-next`) up to config.catalogMaxPages pages.
   *
   * The catalog has no page-number parameter: the next-page URL carries an
   * opaque, server-generated `a=` token (zlib + base64 state of the result
   * set), so the only reliable way to page is to follow the link the
   * catalog itself renders. Cookies are carried over between pages in case
   * that state is tied to the session.
   */
  async searchBooks(query: string, field: SearchField = "any"): Promise<RawBook[]> {
    const params = new URLSearchParams({
      KatID: "0",
      typ: "repl",
      plnk: `${PLNK_PREFIX[field]}${query}`,
      sort: "byscore",
      forigin: "krakow_biblioteka_ks",
      flang: "pol",
    });

    console.info(`[library] Searching for books with query: '${query}' (${field})`);

    const cookies = new Map<string, string>();
    const seenUrls = new Set<string>();
    const seenRecords = new Set<string>();
    const books: RawBook[] = [];
    let url: string | null = `${this.baseUrl}?${params}`;

    for (let page = 1; url && page <= config.catalogMaxPages; page++) {
      if (page > 1) await sleep(config.catalogPageDelayMs);
      seenUrls.add(url);

      let html: string;
      try {
        html = await this.fetchPage(url, cookies);
      } catch (error) {
        // Later pages are a bonus: keep what we already have.
        if (page > 1) {
          console.warn(`[library] Page ${page} failed, stopping:`, error);
          break;
        }
        throw error;
      }

      const parsed = this.parseResultsPage(html, url);
      const fresh = parsed.books.filter(
        (book) => !book.record_url || !seenRecords.has(book.record_url)
      );
      // A page with only records we already have means the paging looped.
      if (page > 1 && parsed.books.length > 0 && fresh.length === 0) break;
      for (const book of fresh) books.push(book);
      for (const book of parsed.books) {
        if (book.record_url) seenRecords.add(book.record_url);
      }

      url = parsed.nextUrl && !seenUrls.has(parsed.nextUrl) ? parsed.nextUrl : null;
      console.info(
        `[library] Page ${page}: ${parsed.books.length} entries${url ? "" : " (last)"}`
      );
    }

    console.info(`[library] Found ${books.length} book entries`);
    return books;
  }

  /** GET one catalog page, sending and collecting cookies. */
  private async fetchPage(url: string, cookies: Map<string, string>): Promise<string> {
    const headers: Record<string, string> = { "User-Agent": config.userAgent };
    if (cookies.size > 0) {
      headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    let response: Response;
    try {
      response = await fetchWithRetry(url, { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CatalogHttpError(`Catalog request failed: ${message}`);
    }
    if (!response.ok) {
      throw new CatalogHttpError(`Catalog responded with HTTP ${response.status}`);
    }
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const [pair] = header.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return response.text();
  }

  /** Parses one results page: its books and the next-page URL (if any). */
  parseResultsPage(html: string, pageUrl: string): { books: RawBook[]; nextUrl: string | null } {
    const $ = load(html);

    // On the last page the arrow is still rendered, just without href.
    const nextHref = $("a#navi-arr-next[href]").first().attr("href");
    const nextUrl = nextHref ? new URL(nextHref, pageUrl).toString() : null;

    const container = $("div.found-records").first();
    if (container.length === 0) {
      console.warn("[library] No records container found in response");
      return { books: [], nextUrl: null };
    }

    const books: RawBook[] = [];

    container.find("div.record-details").each((_, recordElement) => {
      const record = $(recordElement);
      const desc = record.find("div.record-meta").first();
      if (desc.length === 0) return;

      const recordId = findRecordId($, record);
      const record_url = recordId ? this.recordUrl(recordId) : null;

      // Title: prefer the dedicated element, fall back to h3 / any *title* class.
      let titleSource = desc.find("span.desc-o-mb-title").first();
      if (titleSource.length === 0) titleSource = desc.find("h3").first();
      if (titleSource.length === 0) {
        titleSource = desc.find("div[class*='title' i]").first();
      }
      const title = titleSource.text().trim();

      // Author: prefer the structured block, fall back to any *author* class.
      const authorBlock = desc.find("div.desc-descr-block-author").first();
      let authorEl = authorBlock.find("div.desc-descr-items").first();
      if (authorEl.length === 0) {
        authorEl = desc.find("div[class*='author' i]").first();
      }
      const author = authorEl.text().replace(/\s+/g, " ").trim();

      const branchesBlock = record
        .find("div.record-availability-details")
        .first();
      if (branchesBlock.length === 0) return;

      branchesBlock
        .find("div.record-av-details-row")
        .each((_, rowElement) => {
          const row = $(rowElement);

          const agendaEl = row.find("div.record-av-details-agenda").first();
          const branchName =
            agendaEl.length > 0 ? agendaEl.text().trim() : "";
          const branchMatch = /\d+/.exec(branchName);
          if (!branchMatch) return; // could not extract branch number
          const branch_number = Number.parseInt(branchMatch[0], 10);

          const button = row.find("button.record-av-agenda-button").first();
          const available =
            button.length > 0 &&
            button.hasClass("record-av-agenda-button-available");

          if (!title || !author) return; // skip records with missing title/author

          books.push({ title, author, branch_number, available, record_url });
        });
    });

    return { books, nextUrl };
  }

  /**
   * Searches the live catalog, or the demo catalog depending on
   * config.demoMode ("auto" falls back to demo data when the live one fails).
   */
  async search(
    query: string,
    field: SearchField = "any"
  ): Promise<{ books: RawBook[]; demo: boolean }> {
    const demo = () => ({
      books: demoSearchBooks(query, [...this.libraryCoordinates.keys()], this.baseUrl, field),
      demo: true,
    });
    if (config.demoMode === "on") return demo();
    try {
      return { books: await this.searchBooks(query, field), demo: false };
    } catch (error) {
      if (config.demoMode === "off") throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[library] Live catalog failed (${message}); using demo data`);
      return demo();
    }
  }

  /** Fetches books and returns them sorted by distance from userLocation. */
  async getBooksWithDistances(
    query: string,
    userLocation: Coordinates,
    field: SearchField = "any"
  ): Promise<{ books: Book[]; demo: boolean }> {
    const { books, demo } = await this.search(query, field);

    // Precompute branch distances once (cheap: ~57 branches).
    const branchDistances = new Map<number, number>();
    for (const [branchNumber, coords] of this.libraryCoordinates) {
      branchDistances.set(
        branchNumber,
        DistanceCalculator.haversine(userLocation, coords)
      );
    }

    const withDistances = books
      .map((book) => {
        const coords = this.libraryCoordinates.get(book.branch_number);
        return {
          ...book,
          distance_km:
            branchDistances.get(book.branch_number) ??
            Number.POSITIVE_INFINITY,
          branch_lat: coords?.lat ?? null,
          branch_lon: coords?.lon ?? null,
        };
      })
      .sort((a, b) => a.distance_km - b.distance_km);
    return { books: withDistances, demo };
  }
}

// Instantiate the catalog once and reuse it for all requests.
// On Vercel this lives in the serverless instance's module scope,
// so the CSV is loaded only on the first (cold-start) request.
let catalogInstance: LibraryCatalog | null = null;

export function getCatalog(): LibraryCatalog {
  catalogInstance ??= new LibraryCatalog();
  return catalogInstance;
}
