/**
 * Configuration, loaded from environment variables.
 *
 * Required:
 *   LOCATIONIQ_API_KEY  - LocationIQ geocoding API key (https://locationiq.com/)
 *
 * Optional:
 *   LIBRARY_CSV         - path to the branch-coordinates CSV
 *   CATALOG_BASE_URL    - base URL of the Kraków library catalog
 *   LOCATIONIQ_BASE_URL - LocationIQ search endpoint
 *   LIBRARY_DEMO        - "auto" (default): fall back to demo data when the
 *                         catalog / geocoder fails or no API key is set;
 *                         "1": always use demo data; "0": never.
 */

export type DemoMode = "auto" | "on" | "off";

function parseDemoMode(value: string | undefined): DemoMode {
  if (value === "1" || value === "true" || value === "on") return "on";
  if (value === "0" || value === "false" || value === "off") return "off";
  return "auto";
}

export const DEFAULT_CATALOG_BASE_URL =
  "https://www.krakow-biblioteka.sowa.pl/index.php";
export const DEFAULT_LIBRARY_CSV = "library_coordinates.csv";
export const DEFAULT_LOCATIONIQ_API_KEY = "API_KEY";
export const DEFAULT_LOCATIONIQ_BASE_URL =
  "https://us1.locationiq.com/v1/search";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_USER_AGENT = "LibraryDistanceApp/2.1";

export const config = {
  catalogBaseUrl: process.env.CATALOG_BASE_URL ?? DEFAULT_CATALOG_BASE_URL,
  libraryCsv: process.env.LIBRARY_CSV ?? DEFAULT_LIBRARY_CSV,
  locationiqApiKey:
    process.env.LOCATIONIQ_API_KEY ?? DEFAULT_LOCATIONIQ_API_KEY,
  locationiqBaseUrl:
    process.env.LOCATIONIQ_BASE_URL ?? DEFAULT_LOCATIONIQ_BASE_URL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  userAgent: DEFAULT_USER_AGENT,
  demoMode: parseDemoMode(process.env.LIBRARY_DEMO),
} as const;

/** True when a real LocationIQ key was configured. */
export const hasLocationiqKey =
  config.locationiqApiKey !== DEFAULT_LOCATIONIQ_API_KEY &&
  config.locationiqApiKey.trim() !== "";
