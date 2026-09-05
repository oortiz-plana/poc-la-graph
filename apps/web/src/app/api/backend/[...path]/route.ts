import { NextRequest } from "next/server";

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://api:8000";

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  // Forward the query string too: PL/SQL (and directory) endpoints pass
  // identifiers and filters as query parameters (q, kinds, limit, objectId,
  // from, to, fileId, startLine, ...) rather than path segments.
  const target = `${API_URL}/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  for (const name of [
    "authorization",
    "content-type",
    "accept",
    "idempotency-key",
    "x-request-id",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
