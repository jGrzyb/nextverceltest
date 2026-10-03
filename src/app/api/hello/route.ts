import { NextResponse } from "next/server";

/**
 * Example serverless function.
 * On Vercel, every file in src/app that is named route.ts is
 * deployed as a serverless function that scales automatically
 * with traffic.
 */
export async function GET() {
  return NextResponse.json({
    message: "Hello from a serverless function!",
    timestamp: new Date().toISOString(),
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
    route: "/api/hello",
  });
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return NextResponse.json({
    message: "POST received",
    echoed: body,
    timestamp: new Date().toISOString(),
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
    route: "/api/hello",
  });
}
