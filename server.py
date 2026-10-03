#!/usr/bin/env python3
"""
Tiny HTTP server exposing the library finder API.

Uses only Python stdlib (http.server) — no Flask / uvicorn needed.

Endpoints:

    GET /books?q=<query>&lat=<lat>&lon=<lon>
        All books matching the query, sorted by distance.
        Response: {"results": [ {...}, ... ]}

    GET /available?q=<query>&lat=<lat>&lon=<lon>
        Only currently available books.
        Response: {"results": [ {...}, ... ]}

    GET /closest?q=<query>&lat=<lat>&lon=<lon>
        The single closest available book.
        Response: {"result": {...} | null}

    GET /geocode?address=<address>
        Geocode an address to coordinates.
        Response: {"lat": <float>, "lon": <float>} | {"error": "..."}

    GET /health
        Health check.
        Response: {"status": "ok"}

Start with:  python3 server.py [--port 8000]

Environment variables:
    LOCATIONIQ_API_KEY  LocationIQ geocoding API key (optional, falls back to default)
"""

import json
import logging
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional

from book_scrapper_clean import find_available, find_books, geocode_address, LibraryCatalog

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

CSV_PATH = os.environ.get("LIBRARY_CSV", "library_coordinates_cleaned.csv")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", 8000))

# Instantiate the catalog once at startup and reuse it for all requests.
try:
    CATALOG = LibraryCatalog(csv_filepath=CSV_PATH)
except FileNotFoundError as e:
    print(f"FATAL: {e}", file=sys.stderr)
    print("Set LIBRARY_CSV env var to the path of your branch-coordinates CSV.", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

class LibraryHandler(BaseHTTPRequestHandler):
    def _send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _get_arg(self, name: str) -> Optional[str]:
        query = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
        values = query.get(name, [])
        return values[0] if values else None

    def log_message(self, format: str, *args) -> None:
        logger.info("%s - %s", self.address_string(), format % args)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]

        if path == "/health":
            self._send_json({"status": "ok"})
            return

        if path == "/geocode":
            self._handle_geocode()
            return

        if path in ("/books", "/available", "/closest"):
            self._handle_books(path)
            return

        self._send_json({"error": f"not found: {path}"}, status=404)

    def _handle_geocode(self) -> None:
        address = self._get_arg("address")
        if not address:
            self._send_json({"error": "address query parameter is required"}, status=400)
            return

        try:
            result = geocode_address(address)
        except Exception as e:  # pragma: no cover - defensive
            self._send_json({"error": str(e)}, status=500)
            return

        if result is None:
            self._send_json({"error": f"address not found: '{address}'"}, status=404)
            return

        lat, lon = result
        self._send_json({"lat": lat, "lon": lon})

    def _handle_books(self, path: str) -> None:
        query = self._get_arg("q")
        lat_str = self._get_arg("lat")
        lon_str = self._get_arg("lon")

        if not query or lat_str is None or lon_str is None:
            self._send_json(
                {"error": "query 'q' and coordinates 'lat'/'lon' are required"},
                status=400,
            )
            return

        try:
            lat, lon = float(lat_str), float(lon_str)
        except ValueError:
            self._send_json({"error": "lat and lon must be valid floats"}, status=400)
            return

        if path == "/available":
            results = find_available(query, lat, lon, catalog=CATALOG)
            self._send_json({"results": results})
        elif path == "/closest":
            all_books = find_books(query, lat, lon, catalog=CATALOG)
            available = [b for b in all_books if b["available"]]
            self._send_json({"result": available[0] if available else None})
        else:  # /books
            self._send_json({"results": find_books(query, lat, lon, catalog=CATALOG)})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    arg_parser = argparse.ArgumentParser(description="Library book finder HTTP server")
    arg_parser.add_argument("--port", type=int, default=PORT)
    arg_parser.add_argument("--host", default=HOST)
    args = arg_parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), LibraryHandler)
    print(f"Server running at http://{args.host}:{args.port}/")
    print(f"  GET http://{args.host}:{args.port}/health")
    print(f"  GET http://{args.host}:{args.port}/books?q=Dune&lat=50.0681&lon=19.8991")
    print(f"  GET http://{args.host}:{args.port}/available?q=Dune&lat=50.0681&lon=19.8991")
    print(f"  GET http://{args.host}:{args.port}/closest?q=Dune&lat=50.0681&lon=19.8991")
    print(f"  GET http://{args.host}:{args.port}/geocode?address=Plac+Wolności,+Kraków")
    print("Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.shutdown()
