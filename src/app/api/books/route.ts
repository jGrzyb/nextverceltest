import { NextResponse } from "next/server";
import { findBooks } from "@/lib/library";
import {
  libraryErrorResponse,
  parseBookSearchParams,
} from "@/lib/library/route-utils";

// Uses node:fs to read the branch-coordinates CSV.
export const runtime = "nodejs";

/**
 * GET /api/books?q=<query>&lat=<lat>&lon=<lon>
 * All books matching the query, sorted by distance.
 * Response: {"results": [ {...}, ... ], "demo": <bool>}
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = parseBookSearchParams(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { data: results, demo } = await findBooks(
      parsed.params.query,
      parsed.params.lat,
      parsed.params.lon
    );
    return NextResponse.json({ results, demo });
  } catch (error) {
    return libraryErrorResponse(error);
  }
}
