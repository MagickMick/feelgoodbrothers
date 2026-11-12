import { getRelativeLocaleUrl } from "astro:i18n";

// data
import {
  textTranslations,
  dataTranslations,
  routeTranslations,
} from "@config/translationData.json";
import { locales, defaultLocale } from "@config/siteSettings.json";

/**
 * * text translation helper function
 * @param locale: Language to use for translation, one of the locales
 * @returns function you can use to translate strings according to the src/config/translations.json file
 *
 * ## Example
 *
 * ```ts
 * import { useTranslations, getLocaleFromUrl } from "@js/i18nUtils";
 * const currLocale = getLocaleFromUrl(Astro.url);
 * const t = useTranslations(currLocale);
 * t("blog.time"); // translated string for key "blog.time" in the current locale
 * ```
 */
export function useTranslations(locale: keyof typeof textTranslations) {
  return function t(key: keyof (typeof textTranslations)[typeof locale]) {
    return (
      textTranslations[locale][key] || textTranslations[defaultLocale][key]
    );
  };
}

type Locale = keyof typeof dataTranslations;
type DataKey<T extends Locale> = keyof (typeof dataTranslations)[T];
/**
 * * data file translation helper function
 * @param data: key in the data file to translate, like "siteData" or "navData"
 * @param locale: Language to use for translation, one of the locales
 * @returns appropriate data file as specified in src/config/i18nData.json.ts
 *
 * ## Example
 *
 * ```ts
 * import { getLocaleFromUrl } from "@js/i18nUtils";
 * import { getTranslatedData } from "@js/translations";
 * const currLocale = getLocaleFromUrl(Astro.url);
 * const siteData = getTranslatedData("siteData", currLocale);
 * ```
 */
export function getTranslatedData<T extends Locale, K extends DataKey<T>>(
  data: K,
  locale: T,
): (typeof dataTranslations)[T][K] {
  return (
    dataTranslations[locale][data] || dataTranslations[defaultLocale as T][data]
  );
}

/**
 * * take in a language (ex "nl"), and the current URL, and return the URL of the same page in that language
 * Used by the language switcher and hreflang tags.
 *
 * @param locale: new language
 * @param url: current URL (Astro.url)
 * @param alternates: explicit translations (Astro.locals.alternates) for DB-driven pages
 * @returns new URL pathname (falls back to the home page of that locale when there is no translation)
 */
export function getLocalizedPathname(
  locale: (typeof locales)[number],
  url: URL,
  alternates?: Partial<Record<(typeof locales)[number], string>>,
): string {
  if (alternates) {
    return alternates[locale] ?? getRelativeLocaleUrl(locale, "/");
  }

  // figure out if the current URL has a language in it's path
  const [, lang, ...rest] = url.pathname.split("/");

  let oldPath: string, currLocale: (typeof locales)[number];
  //@ts-ignore
  if (locales.includes(lang)) {
    oldPath = rest.join("/");
    currLocale = lang as (typeof locales)[number];
  } else {
    // default locale without prefix (`prefixDefaultLocale: false`)
    oldPath = url.pathname;
    currLocale = defaultLocale;
  }

  // trim any starting and ending slashes for comparison
  const routeStringTrimmed = oldPath.replace(/\/$/, "").replace(/^\//, "");

  const routes = routeTranslations[currLocale] as Record<string, string>;
  const routeTranslationsKey = Object.keys(routes).find(
    (key) => routes[key] === routeStringTrimmed,
  );

  const translatedRoute = routeTranslationsKey
    ? (routeTranslations[locale] as Record<string, string>)[routeTranslationsKey]
    : routeStringTrimmed;

  const out = getRelativeLocaleUrl(locale, translatedRoute);
  return out.endsWith("/") ? out : `${out}/`;
}
