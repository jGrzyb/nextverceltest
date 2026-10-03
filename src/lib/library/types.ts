/** A book as scraped from the catalog, before distance is computed. */
export interface RawBook {
  title: string;
  author: string;
  branch_number: number;
  available: boolean;
}

/** A book with the distance from the user's location appended. */
export interface Book extends RawBook {
  distance_km: number;
}
