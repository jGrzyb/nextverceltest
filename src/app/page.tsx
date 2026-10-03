import type { Metadata } from "next";
import BookFinder from "@/components/book-finder";

export const metadata: Metadata = {
  title: "Książki w Krakowie — znajdź najbliższą filię",
  description:
    "Przeszukaj katalog Biblioteki Kraków i sprawdź, w której filii najbliżej Ciebie książka jest dostępna.",
};

export default function Page() {
  return <BookFinder />;
}
