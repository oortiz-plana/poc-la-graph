import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, localeCookieName, matchAcceptLanguage } from "./locales";

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(localeCookieName)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : matchAcceptLanguage((await headers()).get("accept-language"));
  return {
    locale,
    messages: (await import(`../../messages/${locale}`)).default,
  };
});
