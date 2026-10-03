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
  matchKey,
  formatDistance,
  plural,
} from "@/lib/format";
import type { Book } from "@/lib/library/types";
import { cn } from "@/lib/utils";

type LocationMode = "device" | "coords";
type AvailabilityFilter = "all" | "available";
type SortBy = "distance" | "availability" | "title";

interface Point {
  lat: number;
  lon: number;
}

interface ResolvedLocation extends Point {
  label: string;
}

interface BookGroup {
  key: string;
  title: string;
  author: string;
  rawTitle: string;
  rawAuthor: string;
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
  { id: "coords", label: "Współrzędne", icon: Crosshair },
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
              ? "Brak zgody na lokalizację. Zezwól na nią w przeglądarce albo wpisz współrzędne."
              : "Nie udało się ustalić lokalizacji. Spróbuj ponownie albo wpisz współrzędne."
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
        copies: [],
        editions: 0,
        availableCount: 0,
        nearestAvailable: null,
      };
      groups.set(key, group);
      branches.set(key, new Map());
      editions.set(key, new Set());
    }
    editions.get(key)!.add(`${book.title}|${book.author}`);

    const byBranch = branches.get(key)!;
    const existing = byBranch.get(book.branch_number);
    if (!existing) {
      byBranch.set(book.branch_number, book);
    } else if (book.available && !existing.available) {
      byBranch.set(book.branch_number, { ...existing, available: true });
    }
  }

  for (const group of groups.values()) {
    group.copies = [...branches.get(group.key)!.values()];
    group.editions = editions.get(group.key)!.size;
    group.copies.sort((a, b) => distanceOf(a) - distanceOf(b));
    group.availableCount = group.copies.filter((c) => c.available).length;
    group.nearestAvailable = group.copies.find((c) => c.available) ?? null;
  }
  return [...groups.values()];
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

// --- Component -------------------------------------------------------------

export default function BookFinder() {
  const queryInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const recent = useRecentSearches();

  // Form state
  const [query, setQuery] = useState("");
  const [locationMode, setLocationMode] = useState<LocationMode>("device");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);

  // Async state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Book[] | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [demo, setDemo] = useState(false);
  const [resolvedLocation, setResolvedLocation] =
    useState<ResolvedLocation | null>(null);

  // View state
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("distance");

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

    setLoading(true);
    try {
      const location = await resolveLocation();
      const response = await fetch(
        `/api/books?q=${encodeURIComponent(q)}&lat=${location.lat}&lon=${location.lon}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          response.status === 502
            ? "Katalog biblioteki nie odpowiada. Spróbuj ponownie za chwilę."
            : (data?.error ?? `Wyszukiwanie nie powiodło się (HTTP ${response.status}).`)
        );
      }
      setResults(data.results);
      setDemo(Boolean(data.demo));
      setSearchedQuery(q);
      setResolvedLocation(location);
      rememberSearch(q);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const groups = useMemo(() => (results ? groupBooks(results) : []), [results]);

  const visibleGroups = useMemo(() => {
    let list = groups;
    if (availability === "available") {
      list = list
        .filter((g) => g.availableCount > 0)
        .map((g) => ({ ...g, copies: g.copies.filter((c) => c.available) }));
    }
    const nearest = (g: BookGroup) =>
      g.nearestAvailable ? distanceOf(g.nearestAvailable) : Number.POSITIVE_INFINITY;
    const sorted = [...list];
    switch (sortBy) {
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
  }, [groups, availability, sortBy]);

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
                    placeholder="Tytuł lub autor, np. Diuna"
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
              {demo && <DemoNotice />}

              {closest && (
                <ClosestCard
                  group={closest.group}
                  copy={closest.copy}
                  origin={resolvedLocation}
                />
              )}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Wyniki dla „{searchedQuery}”
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {groups.length} {plural(groups.length, "tytuł", "tytuły", "tytułów")} ·{" "}
                    {branchesWithBook > 0
                      ? `na półce w ${branchesWithBook} ${plural(branchesWithBook, "filii", "filiach", "filiach")}`
                      : "wszystko wypożyczone"}
                    {resolvedLocation && <> · blisko: {resolvedLocation.label}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex gap-0.5 rounded-lg border bg-background p-0.5">
                    {(
                      [
                        ["all", "Wszystkie"],
                        ["available", "Dostępne"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={availability === id}
                        onClick={() => setAvailability(id)}
                        className={cn(
                          "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                          availability === id
                            ? "bg-secondary text-secondary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
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

              {visibleGroups.length === 0 ? (
                <EmptyState
                  icon={Clock}
                  title="Wszystkie egzemplarze są wypożyczone"
                  text="Żadna filia nie ma teraz tej książki na półce. Pokaż wszystkie, żeby zobaczyć, gdzie można ją zarezerwować."
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
                      <BookCard group={group} origin={resolvedLocation} />
                    </li>
                  ))}
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

function DemoNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 animate-fade-up dark:text-amber-200">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">Tryb demo.</span> Katalog biblioteki
        jest teraz niedostępny, więc pokazujemy przykładowe dane.
      </p>
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
}: {
  group: BookGroup;
  copy: Book;
  origin: Point | null;
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
          </p>
          <p className="mt-0.5 text-sm opacity-80" title={group.rawAuthor}>
            {group.author}
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium">
            <Building2 className="size-4" />
            Filia nr {copy.branch_number}
            {distance && (
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">
                {distance} od Ciebie
              </span>
            )}
          </p>
        </div>
        {point && (
          <a
            href={directionsUrl(origin, point)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <Navigation className="size-4" />
            Wyznacz trasę
          </a>
        )}
      </div>
    </div>
  );
}

function BookCard({ group, origin }: { group: BookGroup; origin: Point | null }) {
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
          <CopyRow key={`${copy.branch_number}-${index}`} copy={copy} origin={origin} />
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

function CopyRow({ copy, origin }: { copy: Book; origin: Point | null }) {
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
      <span className={cn("font-medium", !copy.available && "text-muted-foreground")}>
        Filia nr {copy.branch_number}
      </span>
      <span className="text-xs text-muted-foreground">
        {copy.available ? "na półce" : "wypożyczona"}
      </span>
      <span className="ml-auto tabular-nums text-muted-foreground">
        {distance ?? "—"}
      </span>
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
