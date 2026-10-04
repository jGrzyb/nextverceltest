/**
 * Library Book Finder — public API (TypeScript port of book_scrapper_clean.py).
 *
 *   streamBooks(query, lat, lon)    -> the same, one catalog page at a time
 *   findBooks(query, lat, lon)      -> all books sorted by distance
 *                                      (options.field: "any" | "title" | "author")
 *   findAvailable(query, lat, lon)  -> only currently available books
 *   findClosest(query, lat, lon)    -> the single closest available book
 *   geocodeAddress(address)         -> coordinates, or null if not found
 *   geocodeKrakow(address)          -> best Kraków match with its precision
 *
 * Every search result carries `demo: true` when it came from the built-in
 * demo data instead of the live catalog (see LIBRARY_DEMO in config.ts).
 */

import { getCatalog, LibraryCatalog } from "./catalog";
import { Coordinates, DistanceCalculator } from "./coordinates";
import { geocodeAddress, geocodeKrakow, geocodeWithFallback } from "./geocode";
import type { Book, RawBook, SearchField } from "./types";

export { LibraryCatalog, getCatalog, geocodeAddress, geocodeKrakow, geocodeWithFallback };
export { Coordinates, DistanceCalculator };
export type { Book, RawBook, SearchField };

export interface FindOptions {
  /** Catalog field to search (default: everything). */
  field?: SearchField;
  catalog?: LibraryCatalog;
}

export interface SearchResult<T> {
  data: T;
  demo: boolean;
}

/** Search the library catalog and return all books sorted by distance. */
export async function findBooks(
  query: string,
  lat: number,
  lon: number,
  { field = "any", catalog = getCatalog() }: FindOptions = {}
): Promise<SearchResult<Book[]>> {
  const { books, demo } = await catalog.getBooksWithDistances(
    query,
    new Coordinates(lat, lon),
    field
  );
  return { data: books, demo };
}

/**
 * findBooks() one catalog results page at a time, so callers can show the
 * first page while the rest loads. Books keep the catalog order (`rank`).
 */
export async function* streamBooks(
  query: string,
  lat: number,
  lon: number,
  { field = "any", catalog = getCatalog() }: FindOptions = {}
): AsyncGenerator<SearchResult<Book[]>> {
  const origin = new Coordinates(lat, lon);
  for await (const page of catalog.searchPages(query, field)) {
    yield { data: catalog.withDistances(page.books, origin), demo: page.demo };
  }
}

/** Same as findBooks, but only books currently available. */
export async function findAvailable(
  query: string,
  lat: number,
  lon: number,
  options: FindOptions = {}
): Promise<SearchResult<Book[]>> {
  const { data, demo } = await findBooks(query, lat, lon, options);
  return { data: data.filter((book) => book.available), demo };
}

/** The single closest available book, or null when nothing is available. */
export async function findClosest(
  query: string,
  lat: number,
  lon: number,
  options: FindOptions = {}
): Promise<SearchResult<Book | null>> {
  const { data, demo } = await findAvailable(query, lat, lon, options);
  return { data: data[0] ?? null, demo };
}
