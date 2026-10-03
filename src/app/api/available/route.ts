import { NextResponse } from "next/server";
import { findAvailable } from "@/lib/library";
import {
  libraryErrorResponse,
  parseBookSearchParams,
} from "@/lib/library/route-utils";

// Uses node:fs to read the branch-coordinates CSV.
export const runtime = "nodejs";

/**
 * GET /api/available?q=<query>&lat=<lat>&lon=<lon>
 * Only currently available books.
 * Response: {"results": [ {...}, ... ]}
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = parseBookSearchParams(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const results = await findAvailable(
      parsed.params.query,
      parsed.params.lat,
      parsed.params.lon
    );
    return NextResponse.json({ results });
  } catch (error) {
    return libraryErrorResponse(error);
  }
}
