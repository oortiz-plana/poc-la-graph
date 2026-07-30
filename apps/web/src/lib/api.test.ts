import { afterEach, describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "./api";

describe("getRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates the public runtime configuration with Zod", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ projectId: "legal-project" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(getRuntimeConfig()).resolves.toEqual({
      projectId: "legal-project",
    });
  });

  it("rejects malformed runtime configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ projectId: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(getRuntimeConfig()).rejects.toMatchObject({
      name: "ZodError",
    });
  });
});
