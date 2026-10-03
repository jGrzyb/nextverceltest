/**
 * Library Book Finder — public API (TypeScript port of book_scrapper_clean.py).
 *
 *   findBooks(query, lat, lon)      -> all books sorted by distance
 *   findAvailable(query, lat, lon)  -> only currently available books
 *   findClosest(query, lat, lon)    -> the single closest available book
 *   geocodeAddress(address)         -> coordinates, or null if not found
 */

import { getCatalog, LibraryCatalog } from "./catalog";
import type { Book, RawBook } from "./catalog";
import { Coordinates, DistanceCalculator } from "./coordinates";
import { geocodeAddress } from "./geocode";

export { LibraryCatalog, getCatalog, geocodeAddress };
export { Coordinates, DistanceCalculator };
export type { Book, RawBook };

/** Search the library catalog and return all books sorted by distance. */
export async function findBooks(
  query: string,
  lat: number,
  lon: number,
  catalog: LibraryCatalog = getCatalog()
): Promise<Book[]> {
  return catalog.getBooksWithDistances(query, new Coordinates(lat, lon));
}

/** Same as findBooks, but only books currently available. */
export async function findAvailable(
  query: string,
  lat: number,
  lon: number,
  catalog: LibraryCatalog = getCatalog()
): Promise<Book[]> {
  const books = await findBooks(query, lat, lon, catalog);
  return books.filter((book) => book.available);
}

/** The single closest available book, or null when nothing is available. */
export async function findClosest(
  query: string,
  lat: number,
  lon: number,
  catalog: LibraryCatalog = getCatalog()
): Promise<Book | null> {
  const available = await findAvailable(query, lat, lon, catalog);
  return available[0] ?? null;
}
