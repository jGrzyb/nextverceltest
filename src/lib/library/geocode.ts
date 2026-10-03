import { config, hasLocationiqKey } from "./config";
import { DEMO_FALLBACK, demoGeocode } from "./demo";
import {
  buildSearchAttempts,
  COMMON_SEARCH_PARAMS,
  type GeocoderResult,
  type ParsedAddress,
  parseKrakowAddress,
  pickBestResult,
  type PickedResult,
  type Precision,
  type SearchParams,
} from "./krakow-address";

export type { Precision };

/** A Nominatim-compatible geocoder (LocationIQ and Nominatim share the API). */
export interface GeocoderProvider {
  name: "locationiq" | "nominatim";
  search(params: SearchParams): Promise<GeocoderResult[]>;
  /** Address of the point (for verifying results); shares the rate limit. */
  reverse(lat: number, lon: number): Promise<Record<string, string>>;
}

/** The geocoder could not be asked (rate limit, network, bad key) — not "not found". */
export class GeocoderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocoderUnavailableError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spaces requests out to respect provider rate limits. */
function throttled(minIntervalMs: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

/**
 * GET with the provider's throttle; retries rate-limit (429) and server
 * errors with backoff instead of reporting them as "not found".
 * Returns null for "nothing matched" (LocationIQ answers 404 for that).
 */
async function request(
  url: string,
  userAgent: string,
  wait: () => Promise<void>
): Promise<unknown | null> {
  for (let attempt = 0; ; attempt++) {
    await wait();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw new GeocoderUnavailableError(
          `Geocoder unreachable: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (response.status === 404) return null;
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      const body = await response.text().catch(() => "");
      throw new GeocoderUnavailableError(
        `Geocoder responded with HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`
      );
    }
    const retryAfter = Number(response.headers.get("retry-after")) * 1000;
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : RETRY_DELAYS_MS[attempt]);
  }
}

function nominatimCompatible(options: {
  name: GeocoderProvider["name"];
  searchUrl: string;
  userAgent: string;
  minIntervalMs: number;
  extraParams: SearchParams;
}): GeocoderProvider {
  const wait = throttled(options.minIntervalMs);
  const reverseUrl = options.searchUrl.replace(/\/search\/?$/, "/reverse");
  return {
    name: options.name,
    async search(params) {
      const query = new URLSearchParams({
        ...COMMON_SEARCH_PARAMS,
        ...params,
        ...options.extraParams,
      });
      const data = await request(`${options.searchUrl}?${query}`, options.userAgent, wait);
      return Array.isArray(data) ? (data as GeocoderResult[]) : [];
    },
    async reverse(lat, lon) {
      const query = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        format: "json",
        addressdetails: "1",
        zoom: "18",
        "accept-language": "pl",
        ...options.extraParams,
      });
      const data = (await request(`${reverseUrl}?${query}`, options.userAgent, wait)) as {
        address?: Record<string, string>;
      } | null;
      return data?.address ?? {};
    },
  };
}

/**
 * LocationIQ. The free plan allows 2 requests/second AND 60/minute (and
 * 5,000/day) — the per-minute limit is what a burst of searches hits, so
 * requests are spaced ~1 s apart by default (LOCATIONIQ_MIN_INTERVAL_MS).
 */
export function locationiqProvider(apiKey = config.locationiqApiKey): GeocoderProvider {
  return nominatimCompatible({
    name: "locationiq",
    searchUrl: config.locationiqBaseUrl,
    userAgent: config.userAgent,
    minIntervalMs: config.locationiqMinIntervalMs,
    extraParams: { key: apiKey, normalizecity: "1", dedupe: "1" },
  });
}

/**
 * OpenStreetMap Nominatim — free and keyless. Usage policy: max 1 request
 * per second and an identifying User-Agent
 * (https://operations.osmfoundation.org/policies/nominatim/).
 */
export function nominatimProvider(): GeocoderProvider {
  return nominatimCompatible({
    name: "nominatim",
    searchUrl: config.nominatimBaseUrl,
    userAgent: config.nominatimUserAgent,
    minIntervalMs: 1100,
    extraParams: {},
  });
}

let defaultProvider: GeocoderProvider | null = null;

/** LocationIQ when a key is configured, otherwise Nominatim. */
export function getGeocoderProvider(): GeocoderProvider {
  defaultProvider ??= hasLocationiqKey ? locationiqProvider() : nominatimProvider();
  return defaultProvider;
}

/**
 * Geocodes a Kraków address ("ul. Floriańska 3", "al. Mickiewicza 30",
 * "Dworzec Główny"). Tries a few query shapes and only accepts results that
 * are in Kraków and on the typed street — see krakow-address.ts.
 * Returns null when nothing trustworthy was found.
 */
export async function geocodeKrakow(
  address: string,
  provider: GeocoderProvider = getGeocoderProvider()
): Promise<(PickedResult & { parsed: ParsedAddress }) | null> {
  const parsed = parseKrakowAddress(address);
  if (!parsed) return null;

  let fallback: PickedResult | null = null;
  let answered = false;
  let lastError: unknown = null;
  for (const params of buildSearchAttempts(parsed)) {
    let results: GeocoderResult[];
    try {
      results = await provider.search(params);
      answered = true;
    } catch (error) {
      console.warn(`[geocode] ${provider.name} failed for '${address}':`, error);
      lastError = error;
      continue;
    }
    const picked = pickBestResult(parsed, results);
    if (picked?.precision === "address" || (picked && !parsed.houseNumber)) {
      return { ...picked, parsed };
    }
    // Street found but not the number: keep looking, remember it.
    fallback ??= picked;
  }
  if (fallback) return { ...fallback, parsed };
  // Every request failed: say so instead of pretending the address is unknown.
  if (!answered && lastError) {
    throw lastError instanceof GeocoderUnavailableError
      ? lastError
      : new GeocoderUnavailableError(String(lastError));
  }
  return null;
}

/** Back-compat helper: coordinates only. */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lon: number } | null> {
  const result = await geocodeKrakow(address);
  return result ? { lat: result.lat, lon: result.lon } : null;
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** "address" = exact building, "street" = somewhere on the street, "place" = landmark. */
  precision: Precision | null;
  /** Came from the built-in demo place list instead of a geocoder. */
  demo: boolean;
  /** Unknown demo address: the centre of Kraków was used instead. */
  approximate: boolean;
}

// Addresses rarely change; caching also keeps us within rate limits.
const cache = new Map<string, GeocodeResult | null>();

/**
 * geocodeKrakow() plus the demo fallback from config.demoMode: with "auto",
 * if the geocoder finds nothing a few known places are resolved locally and
 * anything else falls back to the city centre (marked `approximate`).
 */
export async function geocodeWithFallback(
  address: string
): Promise<GeocodeResult | null> {
  const key = address.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  let result: GeocodeResult | null = null;
  if (config.demoMode !== "on") {
    let found: Awaited<ReturnType<typeof geocodeKrakow>> = null;
    try {
      found = await geocodeKrakow(address);
    } catch (error) {
      if (config.demoMode === "off") throw error;
      // "auto": fall through to the demo places below.
    }
    if (found) {
      result = {
        lat: found.lat,
        lon: found.lon,
        precision: found.precision,
        demo: false,
        approximate: false,
      };
    }
  }

  if (!result && config.demoMode !== "off") {
    const known = demoGeocode(address);
    // Don't cache fallbacks: the geocoder may work next time.
    return known
      ? { ...known, precision: "place", demo: true, approximate: false }
      : { ...DEMO_FALLBACK, precision: null, demo: true, approximate: true };
  }

  cache.set(key, result);
  return result;
}
