# nextverceltest

A test project for checking how Next.js and Vercel hosting works — now running a real backend: a **Kraków library book finder** that scrapes the library catalog, computes distances to branches, and geocodes addresses.

Two pages built with Next.js 16 (App Router), React 19, Tailwind CSS v4, and shadcn/ui — plus serverless API routes.

## Library Book Finder API

Ported from the Python `book_scrapper_clean.py` + `server.py` to Next.js route handlers. Each endpoint below is deployed on Vercel as an isolated serverless function.

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/books?q=<query>&lat=<lat>&lon=<lon>` | All books matching the query, sorted by distance. Response: `{"results": [...]}` |
| `GET /api/available?q=<query>&lat=<lat>&lon=<lon>` | Only currently available books. Response: `{"results": [...]}` |
| `GET /api/closest?q=<query>&lat=<lat>&lon=<lon>` | The single closest available book. Response: `{"result": {...} \| null}` |
| Optional `&field=title` / `&field=author` on the three search endpoints | Search only the title or the author (catalog advanced search `__tytul_` / `__autor_`); default `any` |
| `GET /api/geocode?address=<address>` | Geocode an address to coordinates (LocationIQ). Response: `{"lat": <float>, "lon": <float>}` or `{"error": "..."}` |
| `GET /api/health` | Health check. Response: `{"status": "ok"}` |
| `GET /api/hello` | Original serverless smoke-test (GET/POST) |

Each book in the response:

```json
{
  "title": "Diuna",
  "author": "Herbert, Frank (1920-1986). ...",
  "branch_number": 48,
  "available": false,
  "distance_km": 4.21,
  "branch_lat": 50.0549,
  "branch_lon": 19.9095,
  "record_url": "https://www.krakow-biblioteka.sowa.pl/index.php?KatID=0&typ=record&001=KrB26005984"
}
```

Examples:

```bash
curl "http://localhost:3000/api/books?q=Dune&lat=50.0681&lon=19.8991"
curl "http://localhost:3000/api/available?q=Dune&lat=50.0681&lon=19.8991"
curl "http://localhost:3000/api/closest?q=Dune&lat=50.0681&lon=19.8991"
curl "http://localhost:3000/api/geocode?address=Plac+Wolności,+Kraków"
```

### Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `LOCATIONIQ_API_KEY` | No | [LocationIQ](https://locationiq.com/) API key; without it `/api/geocode` uses OpenStreetMap Nominatim (free, max 1 request/s) |
| `NOMINATIM_USER_AGENT` | No | Identifying User-Agent sent to Nominatim (their usage policy requires one) |
| `LIBRARY_CSV` | No | Path to the branch-coordinates CSV (default: `library_coordinates.csv`) |
| `CATALOG_BASE_URL` | No | Kraków library catalog base URL |
| `LOCATIONIQ_BASE_URL` | No | LocationIQ search endpoint |
| `CATALOG_MAX_PAGES` | No | Result pages scraped per search by following the catalog's "next page" link (default `5`) |
| `CATALOG_PAGE_DELAY_MS` | No | Pause between result pages in ms (default `400`) |
| `LIBRARY_DEMO` | No | `auto` (default): fall back to built-in demo data when the catalog or geocoder fails / no key is set; `1`: always demo; `0`: never |

### Data file

`library_coordinates.csv` maps library branches to coordinates (`Library Name,Latitude,Longitude`). The loader extracts the branch number from the name (e.g. `Filia nr 21` → `21`); a numeric-first `branch_number,lat,lon` layout is also supported. Commit this file to the repo so it is included in the Vercel deployment, or point `LIBRARY_CSV` at another location.

### Opening hours

`src/lib/library/branch-hours.ts` holds the weekly opening hours of every branch, copied from [biblioteka.krakow.pl/filie](https://www.biblioteka.krakow.pl/filie) and the branch pages (October 2026). The UI uses it for "otwarte do 19:00 / zamknięte · otwiera jutro o 8:30", the **Otwarte teraz** filter and the ring around open branches on the map (evaluated in Kraków time, refreshed every minute; logic in `src/lib/opening-hours.ts`, unit-tested). The library changes hours from time to time (e.g. filia 43 has temporary hours, filia 53 is closed for renovation), so update the file when that happens.

## Pages

| Route | File | Description |
| ----- | ---- | ----------- |
| `/` | `src/app/page.tsx` | Book finder UI (Polish) — quick place presets that work without geocoding, address / device location / coordinates, results grouped by title with the closest available copy highlighted, search in title / author / everything, a Leaflet + OpenStreetMap map of the branches (green = on the shelf, ring = open now; click a branch in the list to fly to it), opening hours and an "open now" filter, Google Maps directions, recent searches, light/dark theme |
| `/about` | `src/app/about/page.tsx` | How it works and the stack |

## Address geocoding (Kraków)

`src/lib/library/krakow-address.ts` prepares the query and picks the result; `geocode.ts` calls the provider (LocationIQ with `LOCATIONIQ_API_KEY`, otherwise Nominatim).

- Abbreviations are **expanded**, not stripped: `al.` → `aleja`, `pl.` → `plac`, `os.` → `osiedle`, `św.` → `Świętego`, `gen.` → `Generała`…; `ul.` is dropped (OSM street names never contain "ulica"). Postal codes, "Kraków", "Polska" and flat numbers (`6/2`, `6 m. 2`) are removed.
- Searches are bounded to Kraków (`viewbox` + `bounded=1`, `countrycodes=pl`) and try, in order: structured `street=<nr> <street>&city=Kraków`, free-form `<street> <nr>, Kraków`, then the street alone.
- Up to 10 results are fetched and filtered: outside Kraków → rejected; a numbered address on a different street → rejected; exact house number > street > importance. The API returns `precision`: `address`, `street` or `place`.

Tests:

```bash
npm test               # offline unit tests for parsing and result picking
npm run test:geocode   # live: ~35 Kraków addresses against the real geocoder,
                       # checked by distance to a reference point and by reverse geocoding
```

## Library code structure

```
src/lib/library/
├── config.ts        # env-driven configuration (LOCATIONIQ_API_KEY, LIBRARY_CSV, ...)
├── coordinates.ts   # Coordinates validation + haversine DistanceCalculator
├── http.ts          # fetch with timeout + exponential-backoff retries
├── catalog.ts       # CSV loading + catalog scraping (cheerio, follows "next page") + getCatalog()
├── branch-hours.ts  # opening hours of every branch
├── krakow-address.ts # Kraków address parsing + result picking (unit-tested)
├── geocode.ts       # geocodeKrakow() via LocationIQ / Nominatim
├── route-utils.ts   # query-param parsing + error responses
└── index.ts         # public API: findBooks, findAvailable, findClosest, geocodeAddress
```

## Getting Started

The app works out of the box without any keys: when the live catalog is unreachable or `LOCATIONIQ_API_KEY` is missing, it switches to demo data (the UI shows a "Tryb demo" notice). Demo queries that return results: Diuna, Wiedźmin, Sapkowski, Lalka, Hobbit, Tokarczuk, Lem, Orwell…

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts:

```bash
npm run build   # production build
npm run start   # run the production build
npm run lint    # ESLint
```

## Deploying to Vercel

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import it at [vercel.com/new](https://vercel.com/new) — Next.js is detected automatically, no configuration needed.
3. Add `LOCATIONIQ_API_KEY` in the Vercel project settings (Settings → Environment Variables).
4. Every push to the main branch deploys to production; other branches get preview deployments.

On Vercel:

- `/` and `/about` are prerendered at build time and served as static content from the edge.
- `/api/*` route handlers run as serverless functions that scale to zero when idle.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [shadcn/ui](https://ui.shadcn.com) - the component library used here.
