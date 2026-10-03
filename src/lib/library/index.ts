/**
 * Library Book Finder — public API (TypeScript port of book_scrapper_clean.py).
 *
 *   findBooks(query, lat, lon)      -> all books sorted by distance
 *   findAvailable(query, lat, lon)  -> only currently available books
 *   findClosest(query, lat, lon)    -> the single closest available book
 *   geocodeAddress(address)         -> coordinates, or null if not found
 *
 * Every search result carries `demo: true` when it came from the built-in
 * demo data instead of the live catalog (see LIBRARY_DEMO in config.ts).
 */

import { getCatalog, LibraryCatalog } from "./catalog";
import { Coordinates, DistanceCalculator } from "./coordinates";
import { geocodeAddress, geocodeWithFallback } from "./geocode";
import type { Book, RawBook } from "./types";

export { LibraryCatalog, getCatalog, geocodeAddress, geocodeWithFallback };
export { Coordinates, DistanceCalculator };
export type { Book, RawBook };

export interface SearchResult<T> {
  data: T;
  demo: boolean;
}

/** Search the library catalog and return all books sorted by distance. */
export async function findBooks(
  query: string,
  lat: number,
  lon: number,
  catalog: LibraryCatalog = getCatalog()
): Promise<SearchResult<Book[]>> {
  const { books, demo } = await catalog.getBooksWithDistances(
    query,
    new Coordinates(lat, lon)
  );
  return { data: books, demo };
}

/** Same as findBooks, but only books currently available. */
export async function findAvailable(
  query: string,
  lat: number,
  lon: number,
  catalog: LibraryCatalog = getCatalog()
): Promise<SearchResult<Book[]>> {
  const { data, demo } = await findBooks(query, lat, lon, catalog);
  return { data: data.filter((book) => book.available), demo };
}

/** The single closest available book, or null when nothing is available. */
export async function findClosest(
  query: string,
  lat: number,
  lon: number,
  catalog: LibraryCatalog = getCatalog()
): Promise<SearchResult<Book | null>> {
  const { data, demo } = await findAvailable(query, lat, lon, catalog);
  return { data: data[0] ?? null, demo };
}
