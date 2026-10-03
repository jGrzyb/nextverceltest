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
  "branch_lon": 19.9095
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
| `LOCATIONIQ_API_KEY` | Yes (for `/api/geocode`) | [LocationIQ](https://locationiq.com/) API key |
| `LIBRARY_CSV` | No | Path to the branch-coordinates CSV (default: `library_coordinates.csv`) |
| `CATALOG_BASE_URL` | No | Kraków library catalog base URL |
| `LOCATIONIQ_BASE_URL` | No | LocationIQ search endpoint |
| `LIBRARY_DEMO` | No | `auto` (default): fall back to built-in demo data when the catalog or geocoder fails / no key is set; `1`: always demo; `0`: never |

### Data file

`library_coordinates.csv` maps library branches to coordinates (`Library Name,Latitude,Longitude`). The loader extracts the branch number from the name (e.g. `Filia nr 21` → `21`); a numeric-first `branch_number,lat,lon` layout is also supported. Commit this file to the repo so it is included in the Vercel deployment, or point `LIBRARY_CSV` at another location.

## Pages

| Route | File | Description |
| ----- | ---- | ----------- |
| `/` | `src/app/page.tsx` | Book finder UI (Polish) — quick place presets that work without geocoding, address / device location / coordinates, results grouped by title with the closest available copy highlighted, Google Maps directions, recent searches, light/dark theme |
| `/about` | `src/app/about/page.tsx` | How it works and the stack |

## Library code structure

```
src/lib/library/
├── config.ts        # env-driven configuration (LOCATIONIQ_API_KEY, LIBRARY_CSV, ...)
├── coordinates.ts   # Coordinates validation + haversine DistanceCalculator
├── http.ts          # fetch with timeout + exponential-backoff retries
├── catalog.ts       # CSV loading + catalog scraping (cheerio) + getCatalog() singleton
├── geocode.ts       # geocodeAddress() via LocationIQ
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
