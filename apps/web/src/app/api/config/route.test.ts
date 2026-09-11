import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/config", () => {
  const original = process.env.PLSQL_MAX_HOPS;

  afterEach(() => {
    if (original === undefined) delete process.env.PLSQL_MAX_HOPS;
    else process.env.PLSQL_MAX_HOPS = original;
  });

  it("reports the configured PLSQL_MAX_HOPS", async () => {
    process.env.PLSQL_MAX_HOPS = "20";
    const body = await GET().json();
    expect(body.plsqlMaxHops).toBe(20);
  });

  it("defaults to 5 when PLSQL_MAX_HOPS is unset", async () => {
    delete process.env.PLSQL_MAX_HOPS;
    const body = await GET().json();
    expect(body.plsqlMaxHops).toBe(5);
  });
});
