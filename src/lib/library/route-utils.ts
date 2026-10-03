import { NextResponse } from "next/server";
import { CatalogHttpError } from "./catalog";

export interface BookSearchParams {
  query: string;
  lat: number;
  lon: number;
}

export type BookSearchParseResult =
  | { ok: true; params: BookSearchParams }
  | { ok: false; error: string };

/**
 * Parses and validates the ?q=&lat=&lon= query parameters shared by the
 * /books, /available and /closest endpoints.
 */
export function parseBookSearchParams(
  request: Request
): BookSearchParseResult {
  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q");
  const latRaw = searchParams.get("lat");
  const lonRaw = searchParams.get("lon");

  if (!query || latRaw === null || lonRaw === null) {
    return {
      ok: false,
      error: "query 'q' and coordinates 'lat'/'lon' are required",
    };
  }

  const lat = Number.parseFloat(latRaw);
  const lon = Number.parseFloat(lonRaw);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return { ok: false, error: "lat and lon must be valid floats" };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: "lat must be between -90 and 90" };
  }
  if (lon < -180 || lon > 180) {
    return { ok: false, error: "lon must be between -180 and 180" };
  }

  return { ok: true, params: { query, lat, lon } };
}

/**
 * Builds the JSON error response for failures thrown by the library layer.
 * CatalogHttpError (upstream catalog problem) -> 502, anything else -> 500.
 */
export function libraryErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof CatalogHttpError ? 502 : 500;
  return NextResponse.json({ error: message }, { status });
}
