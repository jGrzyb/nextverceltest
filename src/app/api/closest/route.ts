import { NextResponse } from "next/server";
import { findClosest } from "@/lib/library";
import {
  libraryErrorResponse,
  parseBookSearchParams,
} from "@/lib/library/route-utils";

// Uses node:fs to read the branch-coordinates CSV.
export const runtime = "nodejs";

/**
 * GET /api/closest?q=<query>&lat=<lat>&lon=<lon>
 * The single closest available book.
 * Response: {"result": {...} | null}
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = parseBookSearchParams(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await findClosest(
      parsed.params.query,
      parsed.params.lat,
      parsed.params.lon
    );
    return NextResponse.json({ result });
  } catch (error) {
    return libraryErrorResponse(error);
  }
}
