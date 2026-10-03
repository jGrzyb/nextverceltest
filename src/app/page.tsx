import type { Metadata } from "next";
import BookFinder from "@/components/book-finder";

export const metadata: Metadata = {
  title: "nextverceltest — Library Book Finder",
  description:
    "Search the Kraków public library catalog and find the closest branches that have a book.",
};

export default function Page() {
  return <BookFinder />;
}
