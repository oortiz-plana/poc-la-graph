import type { AppLocale } from "@/i18n/locales";
import type messages from "../messages/en";

declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof messages;
  }
}
