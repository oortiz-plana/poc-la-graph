import { afterEach, describe, expect, it, vi } from "vitest";

import { getRuntimeConfig, validateUploadSelection } from "./api";

describe("getRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates the public runtime configuration with Zod", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keycloak: {
              url: "http://localhost:8080",
              realm: "graphify",
              clientId: "graphify-web",
            },
            uploadLimits: {
              maxFileBytes: 2097152,
              maxFiles: 100,
              maxTotalBytes: 33554432,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(getRuntimeConfig()).resolves.toEqual({
      keycloak: {
        url: "http://localhost:8080",
        realm: "graphify",
        clientId: "graphify-web",
      },
      uploadLimits: {
        maxFileBytes: 2097152,
        maxFiles: 100,
        maxTotalBytes: 33554432,
      },
      plsqlEnabled: false,
    });
  });

  it("rejects malformed runtime configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ keycloak: { url: "not-a-url" } }), {
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

describe("validateUploadSelection", () => {
  const limits = {
    maxFileBytes: 2 * 1024 * 1024,
    maxFiles: 100,
    maxTotalBytes: 3 * 1024 * 1024,
  };

  it("accepts readable PDF filenames with spaces and accents", () => {
    const files = [
      new File(["content"], "Resolución (versión final).pdf", {
        type: "application/pdf",
      }),
    ];

    expect(validateUploadSelection(files, limits)).toBeUndefined();
  });

  it("explains empty files and aggregate-size failures before creating a session", () => {
    expect(validateUploadSelection([new File([], "empty.pdf")], limits)).toBe(
      "“empty.pdf” is empty.",
    );

    const largeFiles = [
      new File([new Uint8Array(2 * 1024 * 1024)], "first.pdf"),
      new File([new Uint8Array(2 * 1024 * 1024)], "second.pdf"),
    ];
    expect(validateUploadSelection(largeFiles, limits)).toBe(
      "The selected files exceed the total upload size limit.",
    );
  });
});
