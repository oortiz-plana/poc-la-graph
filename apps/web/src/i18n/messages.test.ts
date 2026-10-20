import { describe, expect, it } from "vitest";
import en from "../../messages/en";
import es from "../../messages/es";
import { matchAcceptLanguage } from "./locales";

function flatten(tree: object, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>(
    (flat, [key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "object" && value !== null
        ? { ...flat, ...flatten(value, path) }
        : { ...flat, [path]: String(value) };
    },
    {},
  );
}

describe("message catalogs", () => {
  it("define the same keys in every locale", () => {
    expect(Object.keys(flatten(es)).sort()).toEqual(
      Object.keys(flatten(en)).sort(),
    );
  });

  it("have no empty values", () => {
    for (const catalog of [en, es]) {
      for (const [key, value] of Object.entries(flatten(catalog))) {
        expect(value.trim(), key).not.toBe("");
      }
    }
  });
});

describe("matchAcceptLanguage", () => {
  it("picks the first supported language", () => {
    expect(matchAcceptLanguage("fr-FR,es-MX;q=0.8,en;q=0.5")).toBe("es");
  });

  it("falls back to the default locale", () => {
    expect(matchAcceptLanguage("fr-FR")).toBe("en");
    expect(matchAcceptLanguage(null)).toBe("en");
  });
});
