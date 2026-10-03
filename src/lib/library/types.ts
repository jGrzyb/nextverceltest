/** Which catalog field to search: everything, the title or the author. */
export type SearchField = "any" | "title" | "author";

export const SEARCH_FIELDS: readonly SearchField[] = ["any", "title", "author"];

/** A book as scraped from the catalog, before distance is computed. */
export interface RawBook {
  title: string;
  author: string;
  branch_number: number;
  available: boolean;
  /** Link to this record (edition) in the library catalog, when found. */
  record_url: string | null;
}

/** A book with the distance from the user's location appended. */
export interface Book extends RawBook {
  distance_km: number;
  /** Branch coordinates (null when the branch is missing from the CSV). */
  branch_lat: number | null;
  branch_lon: number | null;
}
