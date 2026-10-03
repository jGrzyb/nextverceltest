import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { config } from "./config";
import { demoSearchBooks } from "./demo";
import { Coordinates, DistanceCalculator } from "./coordinates";
import { fetchWithRetry } from "./http";
import type { Book, RawBook } from "./types";

export type { Book, RawBook };

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

  /** Scrapes book availability from the library catalog. */
  async searchBooks(query: string): Promise<RawBook[]> {
    const params = new URLSearchParams({
      KatID: "0",
      typ: "repl",
      plnk: `q__${query}`,
      sort: "byscore",
      forigin: "krakow_biblioteka_ks",
      flang: "pol",
    });

    console.info(`[library] Searching for books with query: '${query}'`);

    let response: Response;
    try {
      response = await fetchWithRetry(`${this.baseUrl}?${params}`, {
        headers: { "User-Agent": config.userAgent },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CatalogHttpError(`Catalog request failed: ${message}`);
    }

    if (!response.ok) {
      throw new CatalogHttpError(
        `Catalog responded with HTTP ${response.status}`
      );
    }

    const html = await response.text();
    const $ = load(html);
    const container = $("div.found-records").first();
    if (container.length === 0) {
      console.warn("[library] No records container found in response");
      return [];
    }

    const books: RawBook[] = [];

    container.find("div.record-details").each((_, recordElement) => {
      const record = $(recordElement);
      const desc = record.find("div.record-meta").first();
      if (desc.length === 0) return;

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

          books.push({ title, author, branch_number, available });
        });
    });

    console.info(`[library] Found ${books.length} book entries`);
    return books;
  }

  /**
   * Searches the live catalog, or the demo catalog depending on
   * config.demoMode ("auto" falls back to demo data when the live one fails).
   */
  async search(query: string): Promise<{ books: RawBook[]; demo: boolean }> {
    const demo = () => ({
      books: demoSearchBooks(query, [...this.libraryCoordinates.keys()]),
      demo: true,
    });
    if (config.demoMode === "on") return demo();
    try {
      return { books: await this.searchBooks(query), demo: false };
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
    userLocation: Coordinates
  ): Promise<{ books: Book[]; demo: boolean }> {
    const { books, demo } = await this.search(query);

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
