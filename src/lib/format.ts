/** Display helpers for the book finder UI (Polish locale). */

/** Polish plural form: plural(5, "książka", "książki", "książek") -> "książek". */
export function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "350 m" below a kilometre, "4,2 km" above; null/Infinity -> null. */
export function formatDistance(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} km`;
}

/** Strips the statement of responsibility: "Diuna / Frank Herbert ; tł. ..." -> "Diuna". */
export function cleanTitle(title: string): string {
  const cleaned = title
    .split(" / ")[0]
    .replace(/\[[^\]]*\]/g, "") // "[Dokument dźwiękowy]", "[Książka]"
    .split(" : ")[0] // subtitles differ between editions
    .replace(/\s+/g, " ")
    .replace(/[\s/:;.,=]+$/, "")
    .trim();
  return cleaned || title;
}

/** Lowercase, no diacritics or punctuation: "Diuna." and "diuna" match. */
export function matchKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Herbert, Frank (1920-1986). Autor" -> "Frank Herbert". */
export function cleanAuthor(author: string): string {
  const main = (/^[^(;]+/.exec(author)?.[0] ?? author)
    .replace(/[\s.,]+$/, "")
    .trim();
  const parts = main.split(",").map((part) => part.trim());
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[1]} ${parts[0]}`;
  }
  return main || author;
}

export function directionsUrl(
  origin: { lat: number; lon: number } | null,
  destination: { lat: number; lon: number }
): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.lat},${destination.lon}`,
    travelmode: "walking",
  });
  if (origin) params.set("origin", `${origin.lat},${origin.lon}`);
  return `https://www.google.com/maps/dir/?${params}`;
}
