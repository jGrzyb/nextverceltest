import { NextResponse } from "next/server";

/**
 * GET /api/health
 * Health check.
 * Response: {"status": "ok"}
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({ status: "ok" });
}
