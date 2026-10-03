import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "nextverceltest",
  description:
    "Test project for checking how Next.js and Vercel hosting works.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <nav className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
            <Link href="/" className="text-base font-semibold tracking-tight">
              nextverceltest
            </Link>
            <div className="flex items-center gap-1">
              <Link
                href="/"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Home
              </Link>
              <Link
                href="/about"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                About
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t py-6 text-center text-sm text-muted-foreground">
          nextverceltest — a test project for Next.js on Vercel
        </footer>
      </body>
    </html>
  );
}
