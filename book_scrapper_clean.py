"""
Library Book Finder - reusable library module.

Public API:

    find_books(query, lat, lon) -> List[dict]
        Search the Kraków library catalog and return all books sorted by
        distance from the given coordinates.

    find_available(query, lat, lon) -> List[dict]
        Same as find_books, but only books currently available.

    geocode_address(address, api_key=None) -> Optional[Tuple[float, float]]
        Convert a location name / address to (lat, lon) using LocationIQ.

Each book dict has the shape:

    {
        "title": str,
        "author": str,
        "branch_number": int,
        "available": bool,
        "distance_km": float,
    }

For a reusable, stateful client (one instance, many requests) use the
`LibraryCatalog` class:

    catalog = LibraryCatalog(csv_filepath="library_coordinates_cleaned.csv")
    books = catalog.get_books_with_distances("Dune", Coordinates(50.0681, 19.8991))

Data errors raise ValueError; network / scraping errors raise
requests.RequestException.
"""

import csv
import math
import os
import re
from typing import Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "https://www.krakow-biblioteka.sowa.pl/index.php"
DEFAULT_CSV_PATH = "library_coordinates_cleaned.csv"
DEFAULT_API_KEY = "API_KEY"
DEFAULT_TIMEOUT = 10
DEFAULT_USER_AGENT = "LibraryDistanceApp/2.1"

__all__ = [
    "Coordinates",
    "DistanceCalculator",
    "LibraryCatalog",
    "create_session",
    "find_books",
    "find_available",
    "geocode_address",
    "DEFAULT_BASE_URL",
    "DEFAULT_CSV_PATH",
    "DEFAULT_API_KEY",
    "DEFAULT_TIMEOUT",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class Coordinates:
    """Immutable geographic coordinates with validation."""

    def __init__(self, lat: float, lon: float):
        if not -90 <= lat <= 90:
            raise ValueError(f"Latitude must be between -90 and 90, got {lat}")
        if not -180 <= lon <= 180:
            raise ValueError(f"Longitude must be between -180 and 180, got {lon}")
        self.lat = lat
        self.lon = lon

    def __repr__(self):
        return f"Coordinates(lat={self.lat}, lon={self.lon})"


class DistanceCalculator:
    """Calculates great-circle distances between coordinates."""

    EARTH_RADIUS_KM: float = 6371.0

    @staticmethod
    def haversine(coord1: Coordinates, coord2: Coordinates) -> float:
        """Calculates Great Circle distance between two coordinates in kilometers."""
        lat1_rad, lon1_rad = math.radians(coord1.lat), math.radians(coord1.lon)
        lat2_rad, lon2_rad = math.radians(coord2.lat), math.radians(coord2.lon)

        delta_lat = lat2_rad - lat1_rad
        delta_lon = lon2_rad - lon1_rad

        a = (
            math.sin(delta_lat / 2.0) ** 2
            + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2.0) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return DistanceCalculator.EARTH_RADIUS_KM * c


def create_session(
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = 3,
    backoff_factor: float = 1.0,
    user_agent: str = DEFAULT_USER_AGENT,
) -> requests.Session:
    """Create a requests session with retry logic and timeout."""
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})

    retry_strategy = Retry(
        total=retries,
        backoff_factor=backoff_factor,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    return session


class LibraryCatalog:
    """Reusable client for the Kraków library catalog.

    Instantiate once and reuse across requests (loads the branch CSV only once).
    """

    def __init__(
        self,
        csv_filepath: str = DEFAULT_CSV_PATH,
        base_url: str = DEFAULT_BASE_URL,
        session: Optional[requests.Session] = None,
    ):
        self.base_url = base_url
        self.session = session or create_session()
        self.library_coordinates: Dict[int, Coordinates] = self._load_library_coordinates(csv_filepath)

    @staticmethod
    def _load_library_coordinates(filepath: str) -> Dict[int, Coordinates]:
        """Loads library locations from CSV into a mapping: branch_number -> Coordinates."""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"CSV file not found: {filepath}")

        coordinates_map = {}
        with open(filepath, mode="r", encoding="utf-8") as csvfile:
            reader = csv.reader(csvfile)
            next(reader, None)  # Skip header
            for row_num, row in enumerate(reader, start=2):
                if len(row) >= 3:
                    try:
                        branch_num = int(row[0])
                        lat = float(row[1])
                        lon = float(row[2])
                        coordinates_map[branch_num] = Coordinates(lat=lat, lon=lon)
                    except (ValueError, IndexError) as e:
                        logger.warning(f"Skipping invalid row {row_num}: {row} - {e}")
                elif row:
                    logger.warning(f"Skipping row {row_num} with insufficient columns: {row}")

        if not coordinates_map:
            logger.warning("No valid library coordinates loaded from CSV")
        else:
            logger.info(f"Loaded {len(coordinates_map)} library branch coordinates")

        return coordinates_map

    def search_books(self, query: str) -> List[Dict]:
        """Scrapes book availability from the library catalog."""
        params = {
            "KatID": 0,
            "typ": "repl",
            "plnk": f"q__{query}",
            "sort": "byscore",
            "forigin": "krakow_biblioteka_ks",
            "flang": "pol",
        }

        logger.info(f"Searching for books with query: '{query}'")
        try:
            response = self.session.get(self.base_url, params=params, timeout=DEFAULT_TIMEOUT)
            response.raise_for_status()
        except requests.Timeout:
            logger.error("Request timed out")
            raise
        except requests.HTTPError as e:
            logger.error(f"HTTP error {e.response.status_code}: {e}")
            raise
        except requests.RequestException as e:
            logger.error(f"Network error: {e}")
            raise

        soup = BeautifulSoup(response.content, "html.parser")
        records_container = soup.find("div", class_="found-records")
        if not records_container:
            logger.warning("No records container found in response")
            return []

        books: List[Dict] = []
        for record in records_container.find_all("div", class_="record-details"):
            desc = record.find("div", class_="record-meta")
            if not desc:
                continue

            title_elem = (
                desc.find("span", class_="desc-o-mb-title")
                or desc.find("h3")
                or desc.find("div", class_=re.compile(r"title", re.I))
            )
            title = title_elem.text.strip() if title_elem else ""

            author_block = desc.find("div", class_="desc-descr-block-author")
            author_elem = author_block.find("div", class_="desc-descr-items") if author_block else None
            if not author_elem:
                author_elem = desc.find("div", class_=re.compile(r"author", re.I))
            author = re.sub(r"\s+", " ", author_elem.text.strip()) if author_elem else ""

            branches_block = record.find("div", class_="record-availability-details")
            if not branches_block:
                continue

            for branch_block in branches_block.find_all("div", class_="record-av-details-row"):
                branch_name_elem = branch_block.find("div", class_="record-av-details-agenda")
                branch_name = branch_name_elem.text.strip() if branch_name_elem else ""

                branch_match = re.search(r"\d+", branch_name)
                if not branch_match:
                    logger.debug(f"Could not extract branch number from: '{branch_name}'")
                    continue

                branch_number = int(branch_match.group())

                btn = branch_block.find("button", class_="record-av-agenda-button")
                available = "record-av-agenda-button-available" in btn.get("class", []) if btn else False

                if not title or not author:
                    logger.debug("Skipping record with missing title or author")
                    continue

                books.append(
                    {
                        "title": title,
                        "author": author,
                        "branch_number": branch_number,
                        "available": available,
                    }
                )

        logger.info(f"Found {len(books)} book entries")
        return books

    def get_books_with_distances(self, query: str, user_location: Coordinates) -> List[Dict]:
        """Fetches books and returns them sorted by physical distance from user_location."""
        books = self.search_books(query)

        # Precompute branch distances once (cheap: 57 branches max)
        branch_distances = {
            branch_num: DistanceCalculator.haversine(user_location, coords)
            for branch_num, coords in self.library_coordinates.items()
        }

        results = []
        for book in books:
            distance = branch_distances.get(book["branch_number"], float("inf"))
            book = dict(book)  # copy
            book["distance_km"] = distance
            results.append(book)

        results.sort(key=lambda x: x["distance_km"])
        return results


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def find_books(query: str, lat: float, lon: float, catalog: Optional[LibraryCatalog] = None) -> List[Dict]:
    """
    Search the library catalog and return all books sorted by distance.

    Args:
        query: Book search query (title, author, or keyword).
        lat: User latitude.
        lon: User longitude.
        catalog: Optional reusable LibraryCatalog instance. If not provided,
            a fresh instance is created (CSV reloaded).

    Returns:
        List of dicts: {"title", "author", "branch_number", "available", "distance_km"}
    """
    catalog = catalog or LibraryCatalog()
    results = catalog.get_books_with_distances(query, Coordinates(lat=lat, lon=lon))
    return results


def find_available(query: str, lat: float, lon: float, catalog: Optional[LibraryCatalog] = None) -> List[Dict]:
    """
    Search the library catalog and return only currently available books, sorted by distance.
    """
    return [book for book in find_books(query, lat, lon, catalog=catalog) if book["available"]]


def geocode_address(address: str, api_key: Optional[str] = None) -> Optional[Tuple[float, float]]:
    """
    Geocode an address / location name to (lat, lon) using LocationIQ.

    Args:
        address: e.g. "Krakow, ul. Maina 1" or "Plac Wolności 2".
        api_key: LocationIQ API key. Defaults to the value read from the
            LOCATIONIQ_API_KEY environment variable, then to the shipped default.

    Returns:
        (lat, lon) tuple, or None if the address could not be geocoded.
    """
    if api_key is None:
        api_key = os.environ.get("LOCATIONIQ_API_KEY") or DEFAULT_API_KEY

    clean_address = re.sub(r"\b(ul|al|pl)\.?\s*", "", address, flags=re.IGNORECASE).strip()
    params = {"key": api_key, "q": clean_address, "format": "json"}
    headers = {"User-Agent": DEFAULT_USER_AGENT}

    try:
        response = requests.get("https://us1.locationiq.com/v1/search", params=params, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except (requests.RequestException, KeyError, ValueError, IndexError):
        logger.debug(f"Failed to geocode address: '{address}'")
        pass

    return None


if __name__ == "__main__":
    # Example usage: list the closest available / all books for the title "Dune"
    # using a sample location near Kraków center.
    query = "Dune"
    lat, lon = 50.0614, 19.9366

    print(f"Searching for '{query}' near lat={lat}, lon={lon}...\n")
    books = find_books(query, lat, lon)

    if not books:
        print("No books found.")
    else:
        for i, book in enumerate(books[:10], start=1):
            print(
                f"{i}. {book['title']} | "
                f"author: {book['author']} | "
                f"branch: {book['branch_number']} | "
                f"available: {'yes' if book['available'] else 'no'} | "
                f"distance: {book['distance_km']:.2f} km"
            )
