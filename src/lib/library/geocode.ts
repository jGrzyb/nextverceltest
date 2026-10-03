import { config, hasLocationiqKey } from "./config";
import { DEMO_FALLBACK, demoGeocode } from "./demo";
import { Coordinates } from "./coordinates";

/**
 * Geocodes an address / location name to coordinates using LocationIQ.
 *
 * The API key comes from the LOCATIONIQ_API_KEY environment variable
 * (or the `apiKey` argument). Returns null when the address cannot
 * be geocoded.
 */
export async function geocodeAddress(
  address: string,
  apiKey?: string
): Promise<Coordinates | null> {
  const key = apiKey ?? config.locationiqApiKey;

  // Drop Polish street prefixes ("ul.", "al.", "pl.") which confuse geocoders.
  const cleanAddress = address.replace(/\b(ul|al|pl)\.?\s*/gi, "").trim();

  const params = new URLSearchParams({
    key,
    q: cleanAddress,
    format: "json",
  });

  try {
    const response = await fetch(`${config.locationiqBaseUrl}?${params}`, {
      headers: { "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0] as { lat?: unknown; lon?: unknown };
    const lat = Number.parseFloat(String(first.lat));
    const lon = Number.parseFloat(String(first.lon));
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

    return new Coordinates(lat, lon); // validates the range, may throw
  } catch (error) {
    console.debug(`[geocode] Failed to geocode address: '${address}'`, error);
    return null;
  }
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** Came from the built-in demo place list instead of LocationIQ. */
  demo: boolean;
  /** Unknown demo address: the centre of Kraków was used instead. */
  approximate: boolean;
}

/**
 * geocodeAddress() with the demo fallback from config.demoMode: without an
 * API key (or when LocationIQ fails) a few known Kraków places are resolved
 * locally and anything else falls back to the city centre.
 */
export async function geocodeWithFallback(
  address: string
): Promise<GeocodeResult | null> {
  const useLive = config.demoMode !== "on" && hasLocationiqKey;
  if (useLive || config.demoMode === "off") {
    const coords = await geocodeAddress(address);
    if (coords || config.demoMode === "off") {
      return coords
        ? { lat: coords.lat, lon: coords.lon, demo: false, approximate: false }
        : null;
    }
  }
  const known = demoGeocode(address);
  return known
    ? { ...known, demo: true, approximate: false }
    : { ...DEMO_FALLBACK, demo: true, approximate: true };
}
