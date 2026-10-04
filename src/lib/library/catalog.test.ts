import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryCatalog } from "./catalog";

const BASE = "https://catalog.test/index.php";

const record = (id: string, title: string, branch: number) => `
  <div class="record">
    <a href="index.php?KatID=0&amp;typ=record&amp;001=${id}">${title}</a>
    <div class="record-details">
      <div class="record-meta">
        <span class="desc-o-mb-title">${title}</span>
        <div class="desc-descr-block-author"><div class="desc-descr-items">Herbert, Frank</div></div>
      </div>
      <div class="record-availability-details">
        <div class="record-av-details-row">
          <div class="record-av-details-agenda">Filia nr ${branch}</div>
          <button class="record-av-agenda-button record-av-agenda-button-available">x</button>
        </div>
      </div>
    </div>
  </div>`;

/** A results page; `next` is the href of the next-page arrow (none on the last page). */
const page = (records: string[], next?: string) => `
  <html><body>
    <div id="results-panel"><div class="results-navi-box"><div class="paginate-navi">
      <a rel="nofollow" ${next ? `href="${next}"` : ""} id="navi-arr-next" class="navi-arr navi-arr-right"></a>
    </div></div></div>
    <div class="found-records">${records.join("")}</div>
  </body></html>`;

function mockCatalog(pages: Record<string, string>) {
  const calls: { url: string; cookie: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, cookie: headers.get("cookie") });
    const key = new URL(url).searchParams.get("a") ?? "first";
    const body = pages[key];
    return new Response(body ?? "not found", {
      status: body ? 200 : 404,
      headers: { "set-cookie": "PHPSESSID=abc; path=/" },
    });
  });
  return calls;
}

const catalog = () => new LibraryCatalog({ baseUrl: BASE });

afterEach(() => vi.unstubAllGlobals());

describe("LibraryCatalog.searchBooks pagination", () => {
  it("follows #navi-arr-next until the last page", async () => {
    const calls = mockCatalog({
      first: page([record("KrB1", "Diuna", 2)], "index.php?KatID=0&amp;typ=repl&amp;a=PAGE2"),
      PAGE2: page([record("KrB2", "Mesjasz Diuny", 21)], `${BASE}?KatID=0&amp;a=PAGE3`),
      PAGE3: page([record("KrB3", "Dzieci Diuny", 24)]),
    });

    const books = await catalog().searchBooks("diuna");

    expect(books.map((b) => b.title)).toEqual(["Diuna", "Mesjasz Diuny", "Dzieci Diuny"]);
    expect(books[1].record_url).toBe(`${BASE}?KatID=0&typ=record&001=KrB2`);
    expect(calls).toHaveLength(3);
    // Relative href resolved and &amp; decoded; session cookie carried over.
    expect(calls[1].url).toBe(`${BASE}?KatID=0&typ=repl&a=PAGE2`);
    expect(calls[0].cookie).toBeNull();
    expect(calls[1].cookie).toBe("PHPSESSID=abc");
  });

  it("stops at the page limit", async () => {
    const calls = mockCatalog({
      first: page([record("KrB1", "A", 2)], "?a=P2"),
      P2: page([record("KrB2", "B", 2)], "?a=P3"),
      P3: page([record("KrB3", "C", 2)], "?a=P4"),
      P4: page([record("KrB4", "D", 2)], "?a=P5"),
      P5: page([record("KrB5", "E", 2)], "?a=P6"),
      P6: page([record("KrB6", "F", 2)]),
    });
    const books = await catalog().searchBooks("x");
    expect(calls).toHaveLength(5); // default CATALOG_MAX_PAGES
    expect(books).toHaveLength(5);
  });

  it("stops when a page repeats records it already returned", async () => {
    const calls = mockCatalog({
      first: page([record("KrB1", "A", 2)], "?a=P2"),
      P2: page([record("KrB1", "A", 2)], "?a=P3"),
      P3: page([record("KrB3", "C", 2)]),
    });
    const books = await catalog().searchBooks("x");
    expect(calls).toHaveLength(2);
    expect(books).toHaveLength(1);
  });

  it("keeps the first page when a later page fails", async () => {
    mockCatalog({ first: page([record("KrB1", "A", 2)], "?a=MISSING") });
    const books = await catalog().searchBooks("x");
    expect(books.map((b) => b.title)).toEqual(["A"]);
  });
});

describe("LibraryCatalog.searchBooks field", () => {
  it.each([
    ["any", "q__diuna"],
    ["title", "__tytul_diuna"],
    ["author", "__autor_diuna"],
  ] as const)("%s searches plnk=%s", async (field, plnk) => {
    const calls = mockCatalog({ first: page([]) });
    await catalog().searchBooks("diuna", field);
    expect(new URL(calls[0].url).searchParams.get("plnk")).toBe(plnk);
  });
});

describe("LibraryCatalog.searchBookPages", () => {
  it("yields each page as it arrives, ranked in catalog order", async () => {
    mockCatalog({
      first: page([record("KrB1", "Diuna", 2), record("KrB2", "Diuna : powieść", 21)], "?a=P2"),
      P2: page([record("KrB3", "Mesjasz Diuny", 24)]),
    });
    const pages: { title: string; rank?: number }[][] = [];
    for await (const books of catalog().searchBookPages("diuna")) {
      pages.push(books.map(({ title, rank }) => ({ title, rank })));
    }
    expect(pages).toEqual([
      [
        { title: "Diuna", rank: 0 },
        { title: "Diuna : powieść", rank: 1 },
      ],
      [{ title: "Mesjasz Diuny", rank: 2 }],
    ]);
  });
});


describe("LibraryCatalog record links", () => {
  const details = (title: string, branch = 2) => `
    <div class="record-details">
      <div class="record-meta">
        <span class="desc-o-mb-title">${title}</span>
        <div class="desc-descr-block-author"><div class="desc-descr-items">Prus, Bolesław</div></div>
      </div>
      <div class="record-availability-details">
        <div class="record-av-details-row">
          <div class="record-av-details-agenda">Filia nr ${branch}</div>
          <button class="record-av-agenda-button">x</button>
        </div>
      </div>
    </div>`;
  const parse = (body: string) =>
    catalog().parseResultsPage(
      `<html><body><div class="found-records">${body}</div></body></html>`,
      `${BASE}?KatID=0`
    ).books;

  it("finds the link several levels above the record", () => {
    const [book] = parse(`
      <div class="hit"><a href="?KatID=0&amp;typ=record&amp;001=KrB111">Lalka</a>
        <div class="a"><div class="b"><div class="c">${details("Lalka")}</div></div></div>
      </div>`);
    expect(book.record_url).toBe(`${BASE}?KatID=0&typ=record&001=KrB111`);
  });

  it("reads URL-encoded and attribute-only ids", () => {
    const books = parse(`
      <div class="hit"><a href="index.php?go=x%26001%3DKrB22200">Lalka</a>${details("Lalka")}</div>
      <div class="hit" data-record="KrB33300">${details("Faraon")}</div>`);
    expect(books.map((b) => b.record_url)).toEqual([
      `${BASE}?KatID=0&typ=record&001=KrB22200`,
      `${BASE}?KatID=0&typ=record&001=KrB33300`,
    ]);
  });

  it("never borrows the neighbouring record's link", () => {
    const books = parse(`
      <div class="hit"><a href="?typ=record&amp;001=KrB444">Lalka</a>${details("Lalka")}</div>
      <div class="hit">${details("Faraon : powieść / Bolesław Prus")}</div>`);
    expect(books[0].record_url).toContain("001=KrB444");
    // No id: falls back to a title search instead of no link at all.
    expect(new URL(books[1].record_url!).searchParams.get("plnk")).toBe("__tytul_Faraon");
  });
});
