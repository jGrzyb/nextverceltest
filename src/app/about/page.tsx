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

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16">
      <div className="flex flex-col items-start gap-4">
        <Badge variant="secondary">About</Badge>
        <h1 className="text-4xl font-bold tracking-tight">
          About this project
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          nextverceltest is a sandbox for verifying how a modern Next.js app
          behaves when hosted on Vercel.
        </p>
      </div>

      <div className="mt-12 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>The stack</CardTitle>
            <CardDescription>What this project is built with</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Next.js 16 — App Router, React Server Components</li>
              <li>React 19</li>
              <li>Tailwind CSS v4 (via @tailwindcss/postcss)</li>
              <li>shadcn/ui (base-nova style, Base UI primitives, Lucide icons)</li>
              <li>TypeScript</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Serverless on Vercel</CardTitle>
            <CardDescription>How the backend works</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Files named <code>route.ts</code> inside the App Router become
              Route Handlers. On Vercel each one is deployed as an isolated
              serverless function — no server to manage, scaling to zero when
              idle and spinning up automatically on request. This project
              includes one at <code>/api/hello</code> (GET and POST) that you
              can call from the Home page.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deploying</CardTitle>
            <CardDescription>Push to Git, deploy on Vercel</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Push this repository to GitHub, GitLab, or Bitbucket.</li>
              <li>
                Import it in the Vercel dashboard (vercel.com/new) — Next.js is
                auto-detected, zero configuration required.
              </li>
              <li>
                Every git push to the main branch produces a production
                deployment; other branches get preview deployments.
              </li>
              <li>
                Pages (<code>/</code>, <code>/about</code>) are prerendered at
                build time and served from the edge; <code>/api/hello</code>
                runs as a serverless function.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="mt-10">
        <Link className={buttonVariants({ variant: "outline" })} href="/">
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}
