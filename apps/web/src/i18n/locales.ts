export const locales = ["en", "es"] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "en";
export const localeCookieName = "locale";

export function isLocale(value: string | undefined): value is AppLocale {
  return locales.some((locale) => locale === value);
}

export function matchAcceptLanguage(header: string | null): AppLocale {
  const requested = (header ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().slice(0, 2).toLowerCase());
  return requested.find(isLocale) ?? defaultLocale;
}
