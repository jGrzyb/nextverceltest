import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Layers, MapPinned, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "O projekcie — Książka w Twojej Okolicy",
};

const STEPS = [
  {
    icon: Search,
    title: "Szukasz",
    text: "Wpisujesz tytuł lub autora. Serwer pyta katalog Biblioteki Kraków o wszystkie egzemplarze.",
  },
  {
    icon: MapPinned,
    title: "Liczymy odległość",
    text: "Dla każdej filii liczymy odległość w linii prostej od wybranego miejsca lub Twojej lokalizacji.",
  },
  {
    icon: Layers,
    title: "Porządkujemy",
    text: "Grupujemy egzemplarze według tytułu i na górze pokazujemy najbliższy, który jest na półce.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col items-start gap-4">
        <Badge variant="secondary">O projekcie</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Jak to działa
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Wyszukiwarka sprawdza dostępność książek w filiach Biblioteki Kraków
          i podpowiada, dokąd masz najbliżej.
        </p>
      </div>

      <ol className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Card className="h-full">
              <CardHeader>
                <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="size-4" />
                </span>
                <CardTitle>
                  {index + 1}. {step.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                {step.text}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <div className="mt-10">
        <Link className={buttonVariants({ variant: "outline" })} href="/">
          <ArrowLeft />
          Wróć do wyszukiwarki
        </Link>
      </div>
    </div>
  );
}
