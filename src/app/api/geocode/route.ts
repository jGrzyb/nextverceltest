import { NextResponse } from "next/server";
import { geocodeWithFallback } from "@/lib/library";

/**
 * GET /api/geocode?address=<address>
 * Geocodes an address to coordinates via LocationIQ
 * (API key from the LOCATIONIQ_API_KEY environment variable), falling back
 * to built-in demo places when no key is set (see LIBRARY_DEMO).
 * Response: {"lat", "lon", "demo", "approximate"} | {"error": "..."}
 */
export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address");
  if (!address) {
    return NextResponse.json(
      { error: "address query parameter is required" },
      { status: 400 }
    );
  }

  const coordinates = await geocodeWithFallback(address);
  if (!coordinates) {
    return NextResponse.json(
      { error: `address not found: '${address}'` },
      { status: 404 }
    );
  }

  return NextResponse.json(coordinates);
}
