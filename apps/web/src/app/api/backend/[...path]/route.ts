import { NextRequest } from "next/server";

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://api:8000";

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const target = `${API_URL}/${path.join("/")}`;
  const response = await fetch(target, {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("content-type") ?? "application/json",
    },
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text(),
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
export const DELETE = proxy;
