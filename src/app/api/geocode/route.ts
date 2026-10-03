import { NextResponse } from "next/server";
import { geocodeWithFallback } from "@/lib/library";
import { GeocoderUnavailableError } from "@/lib/library/geocode";

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

  let coordinates;
  try {
    coordinates = await geocodeWithFallback(address);
  } catch (error) {
    if (error instanceof GeocoderUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
  if (!coordinates) {
    return NextResponse.json(
      { error: `address not found: '${address}'` },
      { status: 404 }
    );
  }

  return NextResponse.json(coordinates);
}
