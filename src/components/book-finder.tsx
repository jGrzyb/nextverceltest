"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleX,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Book } from "@/lib/library/types";

type LocationMode = "address" | "coords" | "device";
type AvailabilityFilter = "all" | "available" | "unavailable";
type SortBy = "distance" | "title" | "author" | "availability";

interface ResolvedLocation {
  lat: number;
  lon: number;
  label: string;
}

const LOCATION_MODES: { id: LocationMode; label: string }[] = [
  { id: "address", label: "Address / city" },
  { id: "coords", label: "Coordinates" },
  { id: "device", label: "My location" },
];

const AVAILABILITY_FILTERS: {
  id: AvailabilityFilter;
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "unavailable", label: "Unavailable" },
];

function formatDistance(km: number): string {
  return Number.isFinite(km) ? `${km.toFixed(2)} km` : "n/a";
}

export default function BookFinder() {
  // Form state
  const [query, setQuery] = useState("");
  const [locationMode, setLocationMode] = useState<LocationMode>("address");
  const [address, setAddress] = useState("Kraków");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  // Async state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Book[] | null>(null);
  const [resolvedLocation, setResolvedLocation] =
    useState<ResolvedLocation | null>(null);

  // View state
  const [availability, setAvailability] =
    useState<AvailabilityFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("distance");

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Geolocation is not supported by this browser"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    });
  }

  async function locateDevice(): Promise<{ lat: number; lon: number }> {
    if (deviceLocation) return deviceLocation;
    const position = await getPosition();
    const coords = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
    };
    setDeviceLocation(coords);
    return coords;
  }

  async function resolveLocation(): Promise<ResolvedLocation> {
    if (locationMode === "address") {
      const trimmed = address.trim();
      if (!trimmed) throw new Error("Enter an address or city name");

      const response = await fetch(
        `/api/geocode?address=${encodeURIComponent(trimmed)}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.error ?? `Geocoding failed (HTTP ${response.status})`
        );
      }
      return { lat: data.lat, lon: data.lon, label: trimmed };
    }

    if (locationMode === "coords") {
      const parsedLat = Number.parseFloat(lat);
      const parsedLon = Number.parseFloat(lon);
      if (Number.isNaN(parsedLat) || Number.isNaN(parsedLon)) {
        throw new Error("Enter valid latitude and longitude");
      }
      if (
        parsedLat < -90 ||
        parsedLat > 90 ||
        parsedLon < -180 ||
        parsedLon > 180
      ) {
        throw new Error(
          "Latitude must be within -90…90 and longitude within -180…180"
        );
      }
      return {
        lat: parsedLat,
        lon: parsedLon,
        label: `${parsedLat}, ${parsedLon}`,
      };
    }

    const coords = await locateDevice();
    return { lat: coords.lat, lon: coords.lon, label: "Your device location" };
  }

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setError(null);

    if (!query.trim()) {
      setError("Enter a book title or author");
      return;
    }

    setLoading(true);
    try {
      const location = await resolveLocation();
      const response = await fetch(
        `/api/books?q=${encodeURIComponent(query.trim())}&lat=${location.lat}&lon=${location.lon}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.error ?? `Search failed (HTTP ${response.status})`
        );
      }
      setResults(data.results);
      setResolvedLocation(location);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
      setResolvedLocation(null);
    } finally {
      setLoading(false);
    }
  }

  const books = useMemo(() => {
    if (!results) return [];

    let list = results;
    if (availability === "available") {
      list = list.filter((book) => book.available);
    } else if (availability === "unavailable") {
      list = list.filter((book) => !book.available);
    }

    const sorted = [...list];
    switch (sortBy) {
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title, "pl"));
        break;
      case "author":
        sorted.sort((a, b) => a.author.localeCompare(b.author, "pl"));
        break;
      case "availability":
        sorted.sort(
          (a, b) =>
            Number(b.available) - Number(a.available) ||
            a.distance_km - b.distance_km
        );
        break;
      default:
        sorted.sort((a, b) => a.distance_km - b.distance_km);
    }
    return sorted;
  }, [results, availability, sortBy]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col items-start gap-4">
        <Badge variant="secondary">Library Book Finder</Badge>
        <h1 className="text-4xl font-bold tracking-tight">
          Find books near you
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Search the Kraków public library catalog and see which
          branches have the book, sorted by distance from your
          location.
        </p>
      </div>

      <form onSubmit={search} className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
            <CardDescription>
              Choose a location source, then enter a book title or
              author.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="query">Book title or author</Label>
              <div className="flex gap-2">
                <Input
                  id="query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. Dune"
                  className="flex-1"
                />
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Search />
                  )}
                  Search
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Location</Label>
              <div className="inline-flex gap-1 rounded-lg border p-1">
                {LOCATION_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setLocationMode(mode.id)}
                    className={cn(
                      buttonVariants({
                        variant:
                          locationMode === mode.id ? "secondary" : "ghost",
                        size: "sm",
                      })
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {locationMode === "address" && (
                <div className="space-y-1.5">
                  <Input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Street or city, e.g. Plac Wolności, Kraków"
                    aria-label="Address or city name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Geocoding runs on the server via LocationIQ
                    (requires the LOCATIONIQ_API_KEY environment
                    variable).
                  </p>
                </div>
              )}

              {locationMode === "coords" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="lat">Latitude</Label>
                    <Input
                      id="lat"
                      type="number"
                      step="any"
                      value={lat}
                      onChange={(event) => setLat(event.target.value)}
                      placeholder="50.0614"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lon">Longitude</Label>
                    <Input
                      id="lon"
                      type="number"
                      step="any"
                      value={lon}
                      onChange={(event) => setLon(event.target.value)}
                      placeholder="19.9366"
                    />
                  </div>
                </div>
              )}

              {locationMode === "device" && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => {
                      setError(null);
                      locateDevice().catch((err: unknown) => {
                        setError(
                          err instanceof Error ? err.message : String(err)
                        );
                      });
                    }}
                  >
                    <LocateFixed />
                    Use my location
                  </Button>
                  {deviceLocation && (
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {deviceLocation.lat.toFixed(4)},{" "}
                      {deviceLocation.lon.toFixed(4)}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Requires HTTPS and browser permission.
                  </p>
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </form>

      {results && (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {results.length}
              </span>{" "}
              book{results.length === 1 ? "" : "s"} found
              {resolvedLocation && (
                <>
                  {" · near "}
                  <span className="font-medium text-foreground">
                    {resolvedLocation.label}
                  </span>{" "}
                  ({resolvedLocation.lat.toFixed(4)},{" "}
                  {resolvedLocation.lon.toFixed(4)})
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex gap-1 rounded-lg border p-1">
                {AVAILABILITY_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setAvailability(filter.id)}
                    className={cn(
                      buttonVariants({
                        variant:
                          availability === filter.id ? "secondary" : "ghost",
                        size: "sm",
                      })
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as SortBy)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="distance">
                    Distance (nearest)
                  </SelectItem>
                  <SelectItem value="title">Title (A–Z)</SelectItem>
                  <SelectItem value="author">Author (A–Z)</SelectItem>
                  <SelectItem value="availability">Availability</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {books.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No books match the current filter.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Distance</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((book, index) => (
                    <tr
                      key={`${book.branch_number}-${book.title}-${index}`}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">{book.title}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                        {book.author}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        Branch {book.branch_number}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDistance(book.distance_km)}
                      </td>
                      <td className="px-4 py-3">
                        {book.available ? (
                          <Badge className="gap-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Available
                          </Badge>
                        ) : (
                          <Badge className="gap-1 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400">
                            <CircleX className="h-3 w-3" />
                            Loaned
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
