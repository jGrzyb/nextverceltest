import { NextResponse } from "next/server";
import { findBooks, streamBooks } from "@/lib/library";
import {
  type BookSearchParams,
  libraryErrorResponse,
  parseBookSearchParams,
} from "@/lib/library/route-utils";

// Uses node:fs to read the branch-coordinates CSV.
export const runtime = "nodejs";

/**
 * GET /api/books?q=<query>&lat=<lat>&lon=<lon>[&field=any|title|author]
 * All books matching the query, sorted by distance.
 * Response: {"results": [ {...}, ... ], "demo": <bool>}
 *
 * With &stream=1 the response is NDJSON, one line per catalog results page
 * as soon as it is scraped (the catalog serves long result lists in pages):
 *   {"type":"page","page":1,"results":[...],"demo":false}
 *   ...
 *   {"type":"done"}            or  {"type":"error","error":"..."}
 * An error before the first page is a normal JSON error response instead.
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = parseBookSearchParams(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (new URL(request.url).searchParams.get("stream") === "1") {
    return streamResponse(parsed.params);
  }

  try {
    const { data: results, demo } = await findBooks(
      parsed.params.query,
      parsed.params.lat,
      parsed.params.lon,
      { field: parsed.params.field }
    );
    return NextResponse.json({ results, demo });
  } catch (error) {
    return libraryErrorResponse(error);
  }
}

async function streamResponse(params: BookSearchParams): Promise<Response> {
  const pages = streamBooks(params.query, params.lat, params.lon, {
    field: params.field,
  });

  // Wait for the first page so that a failing search still gets a proper
  // HTTP status (502 etc.) instead of an error line inside a 200 stream.
  let first: IteratorResult<{ data: unknown; demo: boolean }>;
  try {
    first = await pages.next();
  } catch (error) {
    return libraryErrorResponse(error);
  }

  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let page = 0;
      let next = first;
      try {
        while (!next.done) {
          page++;
          controller.enqueue(
            line({ type: "page", page, results: next.value.data, demo: next.value.demo })
          );
          next = await pages.next();
        }
        controller.enqueue(line({ type: "done" }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(line({ type: "error", error: message }));
      }
      controller.close();
    },
    async cancel() {
      // The user started another search: stop scraping further pages.
      await pages.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
