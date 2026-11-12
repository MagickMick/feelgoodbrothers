// data
import { locales, defaultLocale } from "@config/siteSettings.json";

export type Locale = (typeof locales)[number];

/**
 * * returns the current locale gathered from the URL
 * use like `const currentLocale = getLocaleFromUrl(Astro.url);`
 * Never returns undefined, defaults to the defaultLocale.
 */
export function getLocaleFromUrl(url: URL): Locale {
  const [, locale] = url.pathname.split("/");

  //@ts-ignore
  if (locales.includes(locale)) return locale as Locale;
  return defaultLocale;
}
