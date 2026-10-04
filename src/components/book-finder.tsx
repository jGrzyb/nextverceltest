"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertCircle,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Crosshair,
  History,
  Loader2,
  LocateFixed,
  Navigation,
  RotateCcw,
  Search,
  SearchX,
  Sparkles,
  FlaskConical,
  X,
  ExternalLink,
  MapPin,
  Map as MapIcon,
  DoorOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cleanAuthor,
  cleanTitle,
  directionsUrl,
  subtitleOf,
  matchKey,
  formatDistance,
  plural,
} from "@/lib/format";
import BranchMap, { type MapBranch } from "@/components/branch-map";
import { branchStatus } from "@/lib/library/branch-hours";
import type { Book, SearchField } from "@/lib/library/types";
import type { OpenStatus } from "@/lib/opening-hours";
import { cn } from "@/lib/utils";

type LocationMode = "device" | "address" | "coords";
type AvailabilityFilter = "all" | "available" | "open";
type SortBy = "relevance" | "distance" | "availability" | "title";

interface Point {
  lat: number;
  lon: number;
}

interface ResolvedLocation extends Point {
  label: string;
  /** The address was not found, so the centre of Kraków was used. */
  approximate?: boolean;
  /** The address the user typed (shown in the notice). */
  input?: string;
}

interface BookGroup {
  key: string;
  title: string;
  author: string;
  rawTitle: string;
  rawAuthor: string;
  /** Subtitle shared by every edition ("dla nastolatek"), else null. */
  subtitle: string | null;
  /** Best catalog position among its editions (lower = more relevant). */
  rank: number;
  /** One entry per branch (editions merged), nearest first. */
  copies: Book[];
  /** How many catalog records (editions) were merged into this group. */
  editions: number;
  availableCount: number;
  nearestAvailable: Book | null;
}

const LOCATION_MODES: {
  id: LocationMode;
  label: string;
  icon: typeof LocateFixed;
}[] = [
  { id: "device", label: "Moja lokalizacja", icon: LocateFixed },
  { id: "address", label: "Adres", icon: MapPin },
  { id: "coords", label: "Współrzędne", icon: Crosshair },
];

const SEARCH_FIELD_OPTIONS: { id: SearchField; label: string; placeholder: string }[] = [
  { id: "any", label: "Wszędzie", placeholder: "Tytuł lub autor, np. Diuna" },
  { id: "title", label: "Tytuł", placeholder: "Tytuł, np. Lalka" },
  { id: "author", label: "Autor", placeholder: "Autor, np. Tokarczuk" },
];

const EXAMPLE_QUERIES = ["Diuna", "Wiedźmin", "Lalka", "Hobbit", "Tokarczuk"];

const VISIBLE_COPIES = 4;

// --- Recent searches (localStorage-backed external store) -----------------

const RECENT_KEY = "recent-searches";
const recentListeners = new Set<() => void>();
let recentCache: { raw: string | null; value: string[] } = {
  raw: null,
  value: [],
};

function readRecent(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RECENT_KEY);
  } catch {
    // Storage unavailable: behave as if empty.
  }
  if (raw !== recentCache.raw) {
    let value: string[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) value = parsed.filter((v) => typeof v === "string");
    } catch {
      // Corrupt entry: ignore it.
    }
    recentCache = { raw, value };
  }
  return recentCache.value;
}

function writeRecent(value: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(value));
  } catch {
    // Ignore: recent searches are a convenience only.
  }
  recentListeners.forEach((listener) => listener());
}

function subscribeRecent(listener: () => void) {
  recentListeners.add(listener);
  return () => recentListeners.delete(listener);
}

const EMPTY: string[] = [];

function useRecentSearches() {
  return useSyncExternalStore(subscribeRecent, readRecent, () => EMPTY);
}

function rememberSearch(query: string) {
  const next = [
    query,
    ...readRecent().filter((q) => q.toLowerCase() !== query.toLowerCase()),
  ].slice(0, 5);
  writeRecent(next);
}

// --- Helpers ---------------------------------------------------------------

/** Parses an NDJSON response body line by line as it streams in. */
async function* readLines(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
    if (done) return;
  }
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Ta przeglądarka nie obsługuje geolokalizacji."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Brak zgody na lokalizację. Zezwól na nią w przeglądarce albo wpisz adres."
              : "Nie udało się ustalić lokalizacji. Spróbuj ponownie albo wpisz adres."
          )
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/**
 * The catalog returns one record per edition, each with its own branch list,
 * so the same book shows up many times. Merge records with the same
 * (cleaned) title and author, and keep one row per branch: available when
 * any edition there is on the shelf.
 */
function groupBooks(books: Book[]): BookGroup[] {
  const groups = new Map<string, BookGroup>();
  const branches = new Map<string, Map<number, Book>>();
  const editions = new Map<string, Set<string>>();
  const subtitles = new Map<string, Set<string>>();

  for (const book of books) {
    const title = cleanTitle(book.title);
    const author = cleanAuthor(book.author);
    const key = `${matchKey(title)}|${matchKey(author)}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title,
        author,
        rawTitle: book.title,
        rawAuthor: book.author,
        subtitle: null,
        rank: book.rank ?? Number.POSITIVE_INFINITY,
        copies: [],
        editions: 0,
        availableCount: 0,
        nearestAvailable: null,
      };
      groups.set(key, group);
      branches.set(key, new Map());
      editions.set(key, new Set());
      subtitles.set(key, new Set());
    }
    editions.get(key)!.add(`${book.title}|${book.author}`);
    subtitles.get(key)!.add(subtitleOf(book.title));
    group.rank = Math.min(group.rank, book.rank ?? Number.POSITIVE_INFINITY);

    const byBranch = branches.get(key)!;
    const existing = byBranch.get(book.branch_number);
    if (!existing) {
      byBranch.set(book.branch_number, book);
    } else if (book.available && !existing.available) {
      // Prefer the edition that is on the shelf (and link to its record).
      byBranch.set(book.branch_number, book);
    }
  }

  for (const group of groups.values()) {
    group.copies = [...branches.get(group.key)!.values()];
    group.editions = editions.get(group.key)!.size;
    const subs = subtitles.get(group.key)!;
    group.subtitle = subs.size === 1 ? [...subs][0] || null : null;
    group.copies.sort((a, b) => distanceOf(a) - distanceOf(b));
    group.availableCount = group.copies.filter((c) => c.available).length;
    group.nearestAvailable = group.copies.find((c) => c.available) ?? null;
  }
  return [...groups.values()];
}

/**
 * How well a title answers the query: 0 = the exact title, 1 = the exact
 * title with a subtitle ("… : dla nastolatek"), 2 = starts with the query,
 * 3 = anything else. Ties keep the catalog's own relevance order.
 */
function titleMatch(group: BookGroup, query: string): number {
  const wanted = matchKey(query);
  const main = matchKey(group.title);
  if (main === wanted) return group.subtitle ? 1 : 0;
  return main.startsWith(wanted) ? 2 : 3;
}

/** The API serializes unknown distances (Infinity) as null. */
function distanceOf(book: Book): number {
  return book.distance_km ?? Number.POSITIVE_INFINITY;
}

function branchPoint(book: Book): Point | null {
  return book.branch_lat != null && book.branch_lon != null
    ? { lat: book.branch_lat, lon: book.branch_lon }
    : null;
}

/** Open now = on the shelf and the branch is open. */
function isOpenNow(book: Book, now: Date): boolean {
  return branchStatus(book.branch_number, now)?.open ?? false;
}

/** One map pin per branch: what is on the shelf there across all titles. */
function mapBranches(groups: BookGroup[], now: Date): MapBranch[] {
  const byNumber = new Map<number, MapBranch>();
  for (const group of groups) {
    for (const copy of group.copies) {
      const point = branchPoint(copy);
      if (!point) continue;
      let branch = byNumber.get(copy.branch_number);
      if (!branch) {
        branch = {
          number: copy.branch_number,
          ...point,
          distanceKm: copy.distance_km ?? null,
          availableTitles: [],
          status: branchStatus(copy.branch_number, now),
        };
        byNumber.set(copy.branch_number, branch);
      }
      if (copy.available && !branch.availableTitles.includes(group.title)) {
        branch.availableTitles.push(group.title);
      }
    }
  }
  return [...byNumber.values()];
}

// --- Component -------------------------------------------------------------

export default function BookFinder() {
  const queryInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const recent = useRecentSearches();

  // Form state
  const [query, setQuery] = useState("");
  const [field, setField] = useState<SearchField>("any");
  const [locationMode, setLocationMode] = useState<LocationMode>("device");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);

  // Async state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Book[] | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchedField, setSearchedField] = useState<SearchField>("any");
  const [demo, setDemo] = useState(false);
  const [resolvedLocation, setResolvedLocation] =
    useState<ResolvedLocation | null>(null);

  // View state
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("relevance");
  // Later catalog pages still arriving after the first one is shown.
  const [loadingMore, setLoadingMore] = useState(false);
  const [partial, setPartial] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [mapFocus, setMapFocus] = useState<{ branch: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // "Open now" changes over time: re-evaluate every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // "/" focuses the search box from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        queryInput.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function locateDevice(force = false): Promise<Point> {
    if (deviceLocation && !force) return deviceLocation;
    setLocating(true);
    try {
      const position = await getPosition();
      const coords = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      setDeviceLocation(coords);
      return coords;
    } finally {
      setLocating(false);
    }
  }

  async function resolveLocation(): Promise<ResolvedLocation> {
    if (locationMode === "address") {
      const trimmed = address.trim();
      if (!trimmed) {
        throw new Error("Wpisz ulicę i numer, np. Czarnowiejska 50.");
      }
      const response = await fetch(
        `/api/geocode?address=${encodeURIComponent(trimmed)}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? `Nie znaleźliśmy adresu „${trimmed}” w Krakowie. Sprawdź nazwę ulicy i numer.`
            : (data?.error ?? `Nie udało się znaleźć adresu (HTTP ${response.status}).`)
        );
      }
      return {
        lat: data.lat,
        lon: data.lon,
        label: data.approximate
          ? "centrum Krakowa"
          : data.precision === "street"
            ? `${trimmed} (okolice ulicy)`
            : trimmed,
        approximate: Boolean(data.approximate),
        input: trimmed,
      };
    }

    if (locationMode === "coords") {
      const parsedLat = Number.parseFloat(lat.replace(",", "."));
      const parsedLon = Number.parseFloat(lon.replace(",", "."));
      if (Number.isNaN(parsedLat) || Number.isNaN(parsedLon)) {
        throw new Error("Podaj poprawną szerokość i długość geograficzną.");
      }
      if (
        parsedLat < -90 ||
        parsedLat > 90 ||
        parsedLon < -180 ||
        parsedLon > 180
      ) {
        throw new Error(
          "Szerokość musi mieścić się w zakresie -90…90, a długość -180…180."
        );
      }
      return {
        lat: parsedLat,
        lon: parsedLon,
        label: `${parsedLat.toFixed(4)}, ${parsedLon.toFixed(4)}`,
      };
    }

    const coords = await locateDevice();
    return { ...coords, label: "Twoja lokalizacja" };
  }

  async function search(event?: FormEvent, override?: string) {
    event?.preventDefault();
    setError(null);

    const q = (override ?? query).trim();
    if (!q) {
      setError("Wpisz tytuł książki albo nazwisko autora.");
      queryInput.current?.focus();
      return;
    }
    if (override !== undefined) setQuery(override);

    // A new search cancels the pages still loading for the previous one.
    searchAbort.current?.abort();
    const abort = new AbortController();
    searchAbort.current = abort;

    setLoading(true);
    setLoadingMore(false);
    setPartial(false);
    let shown = false;
    try {
      const location = await resolveLocation();
      const response = await fetch(
        `/api/books?q=${encodeURIComponent(q)}&lat=${location.lat}&lon=${location.lon}&field=${field}&stream=1`,
        { signal: abort.signal }
      );
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(
          response.status === 502
            ? "Katalog biblioteki nie odpowiada. Spróbuj ponownie za chwilę."
            : (data?.error ?? `Wyszukiwanie nie powiodło się (HTTP ${response.status}).`)
        );
      }

      // NDJSON: one line per catalog page. The first page replaces the old
      // results right away; later pages are appended as they arrive.
      for await (const message of readLines(response.body)) {
        if (abort.signal.aborted) return;
        if (message.type === "page") {
          const page = message.results as Book[];
          if (!shown) {
            shown = true;
            setResults(page);
            setDemo(Boolean(message.demo));
            setSearchedQuery(q);
            setSearchedField(field);
            setResolvedLocation(location);
            setMapFocus(null);
            setLoading(false);
            setLoadingMore(true);
            rememberSearch(q);
            requestAnimationFrame(() =>
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            );
          } else {
            setResults((previous) => [...(previous ?? []), ...page]);
          }
        } else if (message.type === "error") {
          if (!shown) throw new Error(String(message.error));
          setPartial(true);
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      if (shown) setPartial(true);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (searchAbort.current === abort) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  const groups = useMemo(() => (results ? groupBooks(results) : []), [results]);

  const visibleGroups = useMemo(() => {
    let list = groups;
    if (availability !== "all") {
      const keep = (c: Book) =>
        c.available && (availability === "available" || isOpenNow(c, now));
      list = list
        .map((g) => ({ ...g, copies: g.copies.filter(keep) }))
        .filter((g) => g.copies.length > 0);
    }
    const nearest = (g: BookGroup) =>
      g.nearestAvailable ? distanceOf(g.nearestAvailable) : Number.POSITIVE_INFINITY;
    const sorted = [...list];
    switch (sortBy) {
      case "relevance":
        sorted.sort(
          (a, b) =>
            titleMatch(a, searchedQuery) - titleMatch(b, searchedQuery) ||
            a.rank - b.rank ||
            nearest(a) - nearest(b)
        );
        break;
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title, "pl"));
        break;
      case "availability":
        sorted.sort(
          (a, b) => b.availableCount - a.availableCount || nearest(a) - nearest(b)
        );
        break;
      default:
        sorted.sort(
          (a, b) =>
            nearest(a) - nearest(b) ||
            distanceOf(a.copies[0]) - distanceOf(b.copies[0])
        );
    }
    return sorted;
  }, [groups, availability, sortBy, now, searchedQuery]);

  const closest = useMemo(() => {
    let best: { group: BookGroup; copy: Book } | null = null;
    for (const group of groups) {
      const copy = group.nearestAvailable;
      if (copy && (!best || distanceOf(copy) < distanceOf(best.copy))) {
        best = { group, copy };
      }
    }
    return best;
  }, [groups]);

  // When the nearest copy's branch is closed: the nearest one open now.
  const closestOpen = useMemo(() => {
    if (!closest || isOpenNow(closest.copy, now)) return null;
    let best: { group: BookGroup; copy: Book } | null = null;
    for (const group of groups) {
      for (const copy of group.copies) {
        if (!copy.available || !isOpenNow(copy, now)) continue;
        if (!best || distanceOf(copy) < distanceOf(best.copy)) best = { group, copy };
      }
    }
    return best;
  }, [groups, closest, now]);

  const pins = useMemo(() => mapBranches(visibleGroups, now), [visibleGroups, now]);

  function focusBranch(branch: number) {
    setShowMap(true);
    // A new object so clicking the same branch again re-centres the map.
    setMapFocus({ branch });
    requestAnimationFrame(() =>
      mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
  }

  const branchesWithBook = new Set(
    groups.flatMap((g) => g.copies.filter((c) => c.available).map((c) => c.branch_number))
  ).size;

  return (
    <div className="relative">
      {/* Soft backdrop glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent),transparent)]"
      />

      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
        <div className="flex flex-col items-center text-center">
          <Badge variant="secondary" className="gap-1.5">
            <Sparkles />
            Biblioteka Kraków
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
            Gdzie najbliżej jest Twoja książka?
          </h1>
          <p className="mt-3 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            Wpisz tytuł lub autora, a pokażemy filie, w których książka czeka
            na półce, zaczynając od najbliższej.
          </p>
        </div>

        <form onSubmit={(e) => search(e)} className="mt-8" noValidate>
          <Card className="gap-0 py-0 shadow-lg shadow-primary/5">
            <div className="p-3 sm:p-4">
              <Label htmlFor="query" className="sr-only">
                Tytuł lub autor
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={queryInput}
                    id="query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={SEARCH_FIELD_OPTIONS.find((o) => o.id === field)!.placeholder}
                    autoComplete="off"
                    enterKeyHint="search"
                    className="h-12 rounded-xl pr-16 pl-10 text-base md:text-base"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        queryInput.current?.focus();
                      }}
                      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Wyczyść"
                    >
                      <X className="size-4" />
                    </button>
                  ) : (
                    <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground sm:block">
                      /
                    </kbd>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-12 rounded-xl px-6 text-base"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <Search />}
                  {loading ? "Szukam…" : "Szukaj"}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Szukaj w:</span>
                <div
                  role="radiogroup"
                  aria-label="Pole wyszukiwania"
                  className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
                >
                  {SEARCH_FIELD_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={field === option.id}
                      onClick={() => {
                        setField(option.id);
                        queryInput.current?.focus();
                      }}
                      className={cn(
                        "h-6 rounded-md px-2.5 font-medium transition-colors",
                        field === option.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <QuickChips
                recent={recent}
                disabled={loading}
                onPick={(q) => search(undefined, q)}
                onClearRecent={() => writeRecent([])}
              />
            </div>

            <div className="space-y-3 border-t bg-muted/40 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Szukaj blisko:</span>
                <div
                  role="tablist"
                  aria-label="Źródło lokalizacji"
                  className="inline-flex gap-0.5 rounded-lg border bg-background p-0.5"
                >
                  {LOCATION_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const active = locationMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => {
                          setLocationMode(mode.id);
                          setError(null);
                          if (mode.id === "device" && !deviceLocation) {
                            locateDevice().catch((err: unknown) =>
                              setError(err instanceof Error ? err.message : String(err))
                            );
                          }
                        }}
                        className={cn(
                          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Icon className="size-3.5" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {locationMode === "address" && (
                <div className="space-y-1 animate-fade-up">
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Ulica i numer, np. Czarnowiejska 50"
                      aria-label="Adres w Krakowie"
                      autoComplete="street-address"
                      className="h-9 bg-background pl-8"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Szukamy w granicach Krakowa, więc nie trzeba dopisywać miasta.
                  </p>
                </div>
              )}

              {locationMode === "coords" && (
                <div className="grid grid-cols-2 gap-2 animate-fade-up">
                  <div className="space-y-1">
                    <Label htmlFor="lat" className="text-xs text-muted-foreground">
                      Szerokość
                    </Label>
                    <Input
                      id="lat"
                      inputMode="decimal"
                      value={lat}
                      onChange={(event) => setLat(event.target.value)}
                      placeholder="50.0614"
                      className="h-9 bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lon" className="text-xs text-muted-foreground">
                      Długość
                    </Label>
                    <Input
                      id="lon"
                      inputMode="decimal"
                      value={lon}
                      onChange={(event) => setLon(event.target.value)}
                      placeholder="19.9366"
                      className="h-9 bg-background"
                    />
                  </div>
                </div>
              )}

              {locationMode === "device" && (
                <div className="flex flex-wrap items-center gap-3 animate-fade-up">
                  {locating ? (
                    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Ustalam lokalizację…
                    </span>
                  ) : deviceLocation ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <Check className="size-3" />
                      </span>
                      Lokalizacja ustalona
                      <span className="font-mono text-xs text-muted-foreground">
                        {deviceLocation.lat.toFixed(4)}, {deviceLocation.lon.toFixed(4)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Przeglądarka poprosi o zgodę na lokalizację.
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={locating}
                    onClick={() => {
                      setError(null);
                      locateDevice(true).catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : String(err))
                      );
                    }}
                  >
                    <LocateFixed />
                    {deviceLocation ? "Odśwież" : "Udostępnij lokalizację"}
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive animate-fade-up"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p className="flex-1">{error}</p>
              {query.trim() && (
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="-my-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <RotateCcw />
                  Ponów
                </Button>
              )}
            </div>
          )}
        </form>

        <section ref={resultsRef} className="mt-10 scroll-mt-20" aria-live="polite">
          {loading ? (
            <ResultsSkeleton />
          ) : results === null ? null : groups.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={`Brak wyników dla „${searchedQuery}”`}
              text="Sprawdź pisownię albo spróbuj samego nazwiska autora lub krótszego tytułu."
            />
          ) : (
            <div className="space-y-5">
              {(demo || resolvedLocation?.approximate) && (
                <DemoNotice
                  demo={demo}
                  approximateFrom={
                    resolvedLocation?.approximate ? (resolvedLocation.input ?? null) : null
                  }
                />
              )}

              {closest && (
                <ClosestCard
                  group={closest.group}
                  copy={closest.copy}
                  origin={resolvedLocation}
                  status={branchStatus(closest.copy.branch_number, now)}
                  openAlternative={closestOpen}
                  onShowOnMap={focusBranch}
                />
              )}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Wyniki dla{" "}
                    {searchedField !== "any" && (
                      <span className="font-normal text-muted-foreground">
                        {searchedField === "title" ? "tytułu" : "autora"}{" "}
                      </span>
                    )}
                    „{searchedQuery}”
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {groups.length} {plural(groups.length, "tytuł", "tytuły", "tytułów")} ·{" "}
                    {branchesWithBook > 0
                      ? `na półce w ${branchesWithBook} ${plural(branchesWithBook, "filii", "filiach", "filiach")}`
                      : "wszystko wypożyczone"}
                    {resolvedLocation && <> · blisko: {resolvedLocation.label}</>}
                  </p>
                  {loadingMore && (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary animate-fade-up">
                      <Loader2 className="size-3.5 animate-spin" />
                      Wczytuję kolejne strony katalogu…
                    </p>
                  )}
                  {partial && !loadingMore && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      Nie udało się wczytać wszystkich stron katalogu, więc część wyników może brakować.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex gap-0.5 rounded-lg border bg-background p-0.5">
                    {(
                      [
                        ["all", "Wszystkie"],
                        ["available", "Dostępne"],
                        ["open", "Otwarte teraz"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={availability === id}
                        onClick={() => setAvailability(id)}
                        className={cn(
                          "h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                          availability === id
                            ? "bg-secondary text-secondary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant={showMap ? "secondary" : "outline"}
                    size="sm"
                    className="h-8"
                    aria-pressed={showMap}
                    onClick={() => setShowMap((v) => !v)}
                  >
                    <MapIcon />
                    Mapa
                  </Button>
                  <Select
                    value={sortBy}
                    onValueChange={(value) => setSortBy(value as SortBy)}
                  >
                    <SelectTrigger className="h-8 w-40" aria-label="Sortowanie">
                      <SelectValue>
                        {(value: SortBy) => SORT_LABELS[value]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
                        <SelectItem key={key} value={key}>
                          {SORT_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {showMap && pins.length > 0 && (
                <div ref={mapRef} className="space-y-2 animate-fade-up scroll-mt-24">
                  <BranchMap
                    origin={resolvedLocation}
                    branches={pins}
                    focus={mapFocus}
                  />
                  <MapLegend />
                </div>
              )}

              {visibleGroups.length === 0 ? (
                <EmptyState
                  icon={availability === "open" ? DoorOpen : Clock}
                  title={
                    availability === "open"
                      ? "Żadna filia z tą książką nie jest teraz otwarta"
                      : "Wszystkie egzemplarze są wypożyczone"
                  }
                  text={
                    availability === "open"
                      ? "Pokaż wszystkie dostępne, żeby zobaczyć, gdzie i kiedy można po nią przyjść."
                      : "Żadna filia nie ma teraz tej książki na półce. Pokaż wszystkie, żeby zobaczyć, gdzie można ją zarezerwować."
                  }
                  action={
                    <Button variant="outline" size="sm" onClick={() => setAvailability("all")}>
                      Pokaż wszystkie
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-3">
                  {visibleGroups.map((group, index) => (
                    <li
                      key={group.key}
                      className="animate-fade-up"
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                    >
                      <BookCard
                        group={group}
                        origin={resolvedLocation}
                        now={now}
                        onShowOnMap={focusBranch}
                      />
                    </li>
                  ))}
                  {loadingMore && (
                    <li aria-hidden>
                      <BookCardSkeleton />
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const SORT_LABELS: Record<SortBy, string> = {
  relevance: "Trafność",
  distance: "Najbliżej",
  availability: "Najwięcej dostępnych",
  title: "Tytuł A–Z",
};

// --- Sub-components ----------------------------------------------------------

function QuickChips({
  recent,
  disabled,
  onPick,
  onClearRecent,
}: {
  recent: string[];
  disabled: boolean;
  onPick: (query: string) => void;
  onClearRecent: () => void;
}) {
  const showRecent = recent.length > 0;
  const items = showRecent ? recent : EXAMPLE_QUERIES;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        {showRecent ? <History className="size-3.5" /> : <Sparkles className="size-3.5" />}
        {showRecent ? "Ostatnio:" : "Spróbuj:"}
      </span>
      {items.map((item) => (
        <button
          key={item}
          type="button"
          disabled={disabled}
          onClick={() => onPick(item)}
          className="h-6 rounded-full bg-secondary px-2.5 font-medium text-secondary-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
        >
          {item}
        </button>
      ))}
      {showRecent && (
        <button
          type="button"
          onClick={onClearRecent}
          className="ml-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          wyczyść
        </button>
      )}
    </div>
  );
}

function DemoNotice({
  demo,
  approximateFrom,
}: {
  demo: boolean;
  approximateFrom: string | null;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 animate-fade-up dark:text-amber-200">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-0.5">
        {demo && (
          <p>
            <span className="font-semibold">Tryb demo.</span> Katalog
            biblioteki jest teraz niedostępny, więc pokazujemy przykładowe dane.
          </p>
        )}
        {approximateFrom && (
          <p>
            Nie udało się zlokalizować adresu „{approximateFrom}”, więc
            odległości liczymy od centrum Krakowa.
          </p>
        )}
      </div>
    </div>
  );
}

function AvailabilityBadge({ group }: { group: BookGroup }) {
  const total = group.copies.length;
  if (group.availableCount === 0) {
    return (
      <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
        Wszystkie wypożyczone
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
      <Check />
      {group.availableCount === total
        ? `Dostępna w ${total} ${plural(total, "filii", "filiach", "filiach")}`
        : `Dostępna w ${group.availableCount} z ${total}`}
    </Badge>
  );
}

function ClosestCard({
  group,
  copy,
  origin,
  status,
  openAlternative,
  onShowOnMap,
}: {
  group: BookGroup;
  copy: Book;
  origin: Point | null;
  status: OpenStatus | null;
  /** Nearest copy in a branch that is open now (when this one is closed). */
  openAlternative: { group: BookGroup; copy: Book } | null;
  onShowOnMap: (branch: number) => void;
}) {
  const point = branchPoint(copy);
  const distance = formatDistance(copy.distance_km);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground shadow-lg shadow-primary/20 animate-fade-up sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/10 blur-2xl"
      />
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase opacity-80">
        <Navigation className="size-3.5" />
        Najbliżej dostępna
      </p>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xl font-semibold text-balance sm:text-2xl" title={group.rawTitle}>
            {group.title}
            {group.subtitle && (
              <span className="font-normal opacity-80"> : {group.subtitle}</span>
            )}
          </p>
          <p className="mt-0.5 text-sm opacity-80" title={group.rawAuthor}>
            {group.author}
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium">
            <button
              type="button"
              onClick={() => onShowOnMap(copy.branch_number)}
              className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
              title="Pokaż na mapie"
            >
              <Building2 className="size-4" />
              Filia nr {copy.branch_number}
            </button>
            {distance && (
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">
                {distance} od Ciebie
              </span>
            )}
            {status && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
                  status.open ? "bg-white text-primary" : "bg-black/15"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    status.open
                      ? status.closingSoon
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                      : "bg-current opacity-60"
                  )}
                  aria-hidden
                />
                {status.label}
              </span>
            )}
          </p>
          {openAlternative && (
            <p className="mt-2 text-xs opacity-90">
              Otwarta teraz najbliżej:{" "}
              <button
                type="button"
                onClick={() => onShowOnMap(openAlternative.copy.branch_number)}
                className="font-semibold underline underline-offset-2"
              >
                filia nr {openAlternative.copy.branch_number}
              </button>
              {formatDistance(openAlternative.copy.distance_km) &&
                `, ${formatDistance(openAlternative.copy.distance_km)}`}
              {openAlternative.group.key !== group.key && ` (${openAlternative.group.title})`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {copy.record_url && (
            <a
              href={copy.record_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium transition-colors hover:bg-white/25"
            >
              <ExternalLink className="size-4" />
              W katalogu
            </a>
          )}
          {point && (
            <a
              href={directionsUrl(origin, point)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <Navigation className="size-4" />
              Wyznacz trasę
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function BookCard({
  group,
  origin,
  now,
  onShowOnMap,
}: {
  group: BookGroup;
  origin: Point | null;
  now: Date;
  onShowOnMap: (branch: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const copies = expanded ? group.copies : group.copies.slice(0, VISIBLE_COPIES);
  const hidden = group.copies.length - copies.length;
  const nearest = group.nearestAvailable;

  return (
    <Card className="gap-0 py-0 transition-shadow hover:shadow-md">
      <div className="flex gap-4 p-4">
        <div
          aria-hidden
          className={cn(
            "hidden h-16 w-12 shrink-0 items-center justify-center rounded-md sm:flex",
            group.availableCount > 0
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          <BookOpen className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 className="font-semibold leading-snug" title={group.rawTitle}>
              {group.title}
              {group.subtitle && (
                <span className="font-normal text-muted-foreground"> : {group.subtitle}</span>
              )}
            </h3>
            <AvailabilityBadge group={group} />
          </div>
          <p className="truncate text-sm text-muted-foreground" title={group.rawAuthor}>
            {group.author}
            {group.editions > 1 && (
              <span className="text-xs">
                {" "}· {group.editions} {plural(group.editions, "wydanie", "wydania", "wydań")}
              </span>
            )}
          </p>
          {nearest && formatDistance(nearest.distance_km) && (
            <p className="mt-1 text-xs text-muted-foreground">
              Najbliżej: filia nr {nearest.branch_number},{" "}
              <span className="font-medium text-foreground">
                {formatDistance(nearest.distance_km)}
              </span>
            </p>
          )}
        </div>
      </div>

      <ul className="divide-y border-t">
        {copies.map((copy, index) => (
          <CopyRow
            key={`${copy.branch_number}-${index}`}
            copy={copy}
            origin={origin}
            status={branchStatus(copy.branch_number, now)}
            onShowOnMap={onShowOnMap}
          />
        ))}
      </ul>

      {group.copies.length > VISIBLE_COPIES && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1 border-t py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {expanded ? "Zwiń" : `Pokaż jeszcze ${hidden} ${plural(hidden, "filię", "filie", "filii")}`}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </Card>
  );
}

function CopyRow({
  copy,
  origin,
  status,
  onShowOnMap,
}: {
  copy: Book;
  origin: Point | null;
  status: OpenStatus | null;
  onShowOnMap: (branch: number) => void;
}) {
  const point = branchPoint(copy);
  const distance = formatDistance(copy.distance_km);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          copy.available ? "bg-emerald-500" : "bg-rose-400"
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {point ? (
            <button
              type="button"
              onClick={() => onShowOnMap(copy.branch_number)}
              className={cn(
                "font-medium underline-offset-4 hover:text-primary hover:underline",
                !copy.available && "text-muted-foreground"
              )}
              title="Pokaż na mapie"
            >
              Filia nr {copy.branch_number}
            </button>
          ) : (
            <span className={cn("font-medium", !copy.available && "text-muted-foreground")}>
              Filia nr {copy.branch_number}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {copy.available ? "na półce" : "wypożyczona"}
          </span>
        </div>
        {status && (
          <p
            className={cn(
              "text-xs",
              status.open
                ? status.closingSoon
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
            )}
            title={`Dziś: ${status.today}`}
          >
            {status.label}
          </p>
        )}
      </div>
      <span className="ml-auto tabular-nums whitespace-nowrap text-muted-foreground">
        {distance ?? "—"}
      </span>
      {copy.record_url ? (
        <a
          href={copy.record_url}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-my-1")}
          aria-label={`Książka w katalogu (filia nr ${copy.branch_number})`}
          title="Zobacz w katalogu biblioteki"
        >
          <ExternalLink />
        </a>
      ) : (
        <span className="size-7" aria-hidden />
      )}
      {point ? (
        <a
          href={directionsUrl(origin, point)}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-my-1")}
          aria-label={`Trasa do filii nr ${copy.branch_number}`}
          title="Trasa w Mapach Google"
        >
          <Navigation />
        </a>
      ) : (
        <span className="size-7" aria-hidden />
      )}
    </li>
  );
}

function MapLegend() {
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
      <span className={item}>
        <span className="size-2.5 rounded-full bg-[oklch(0.6_0.15_160)]" /> na półce
      </span>
      <span className={item}>
        <span className="size-2.5 rounded-full bg-[oklch(0.65_0.02_250)]" /> wypożyczona
      </span>
      <span className={item}>
        <span className="size-2.5 rounded-full bg-[oklch(0.6_0.15_160)] ring-2 ring-[oklch(0.6_0.15_160/0.35)] ring-offset-1 ring-offset-background" />{" "}
        otwarte teraz
      </span>
      <span className={item}>
        <span className="size-2.5 rounded-full bg-primary" /> Ty
      </span>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof SearchX;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <Card className="animate-fade-up">
      <CardContent className="flex flex-col items-center py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </span>
        <p className="mt-4 font-semibold">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}

function BookCardSkeleton() {
  return (
    <div className="rounded-xl border border-dashed bg-card/60 p-4">
      <div className="flex gap-4">
        <div className="hidden h-16 w-12 animate-pulse rounded-md bg-muted sm:block" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-label="Wczytywanie wyników">
      <div className="h-32 animate-pulse rounded-2xl bg-primary/15" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <div className="flex gap-4">
            <div className="hidden h-16 w-12 animate-pulse rounded-md bg-muted sm:block" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
