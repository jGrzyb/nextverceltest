import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { LibraryBig } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle, themeInitScript } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Książka w Twojej Okolicy",
  description:
    "Sprawdź, w której filii Biblioteki Kraków najbliżej Ciebie jest dostępna książka.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pl"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight whitespace-nowrap sm:text-base"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LibraryBig className="size-4" />
              </span>
              Książka w Twojej Okolicy
            </Link>
            <div className="flex items-center gap-1">
              <Link
                href="/"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "hidden sm:inline-flex"
                )}
              >
                Szukaj
              </Link>
              <Link
                href="/about"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                O projekcie
              </Link>
              <ThemeToggle />
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t px-4 py-6 text-center text-sm text-balance text-muted-foreground">
          Dane z katalogu Biblioteki Kraków · odległości w linii prostej
        </footer>
      </body>
    </html>
  );
}
