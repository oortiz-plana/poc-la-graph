import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PATCH, GET } from "./route";

describe("backend proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards PATCH requests used to rename conversations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "Renamed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "http://localhost/api/backend/api/v1/conversations/conv-1",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer memory-only-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Renamed" }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({
        path: ["api", "v1", "conversations", "conv-1"],
      }),
    });

    expect(response.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toMatch(/\/api\/v1\/conversations\/conv-1$/);
    expect(init.method).toBe("PATCH");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer memory-only-token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("forwards the query string so filters and identifiers reach the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], truncated: false, count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "http://localhost/api/backend/api/v1/plsql/objects?q=pkg&limit=10",
      { method: "GET" },
    );

    const response = await GET(request, {
      params: Promise.resolve({ path: ["api", "v1", "plsql", "objects"] }),
    });

    expect(response.status).toBe(200);
    const [target] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toContain("/api/v1/plsql/objects?q=pkg&limit=10");
  });
});
