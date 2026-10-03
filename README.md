# nextverceltest

A test project for checking how Next.js and Vercel hosting works.

Two pages built with Next.js 16 (App Router), React 19, Tailwind CSS v4, and shadcn/ui — plus a serverless API route.

## Pages

| Route | File | Description |
| ----- | ---- | ----------- |
| `/` | `src/app/page.tsx` | Home page with shadcn/ui components and a serverless function tester |
| `/about` | `src/app/about/page.tsx` | About the project, the stack, and deploying to Vercel |
| `/api/hello` | `src/app/api/hello/route.ts` | Serverless function (GET returns JSON, POST echoes the body) |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts:

```bash
npm run build   # production build
npm run start   # run the production build
npm run lint    # ESLint
```

## Deploying to Vercel

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import it at [vercel.com/new](https://vercel.com/new) — Next.js is detected automatically, no configuration needed.
3. Every push to the main branch deploys to production; other branches get preview URLs.

On Vercel:

- `/` and `/about` are prerendered at build time and served as static content from the edge.
- `/api/hello` is deployed as an isolated serverless function that scales to zero when idle.

## Structure

```
src/
├── app/
│   ├── layout.tsx          # root layout with navigation
│   ├── page.tsx            # home page (/)
│   ├── about/page.tsx      # about page (/about)
│   └── api/hello/route.ts  # serverless route handler (/api/hello)
├── components/
│   ├── api-tester.tsx      # client component calling the API route
│   └── ui/                 # shadcn/ui components (button, card, badge)
└── lib/utils.ts            # cn() helper
```
