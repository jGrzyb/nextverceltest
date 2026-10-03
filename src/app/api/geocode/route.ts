import { NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/library";

/**
 * GET /api/geocode?address=<address>
 * Geocodes an address to coordinates via LocationIQ
 * (API key from the LOCATIONIQ_API_KEY environment variable).
 * Response: {"lat": <float>, "lon": <float>} | {"error": "..."}
 */
export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address");
  if (!address) {
    return NextResponse.json(
      { error: "address query parameter is required" },
      { status: 400 }
    );
  }

  const coordinates = await geocodeAddress(address);
  if (!coordinates) {
    return NextResponse.json(
      { error: `address not found: '${address}'` },
      { status: 404 }
    );
  }

  return NextResponse.json({ lat: coordinates.lat, lon: coordinates.lon });
}
