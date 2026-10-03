import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ApiTester from "@/components/api-tester";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16">
      <div className="flex flex-col items-start gap-4">
        <Badge variant="secondary">Test project</Badge>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight">
          nextverceltest
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          A minimal two-page Next.js app with shadcn/ui and Tailwind CSS, built
          to check how Next.js and Vercel hosting works — including serverless
          route handlers.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link className={buttonVariants({ size: "lg" })} href="/about">
            About this project
          </Link>
          <Link
            className={buttonVariants({ variant: "outline", size: "lg" })}
            href="/api/hello"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open /api/hello
          </Link>
        </div>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Page 1 — Home</CardTitle>
            <CardDescription>src/app/page.tsx</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This page. A server component that renders shadcn/ui components
              and a client component that calls the serverless function below.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Page 2 — About</CardTitle>
            <CardDescription>src/app/about/page.tsx</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Explains the stack, how serverless route handlers work on Vercel,
              and how to deploy this project.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <ApiTester />
      </div>
    </div>
  );
}
