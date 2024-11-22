/**
 * * Configuration of the i18n system data files and text translations
 * Example translations below are for English and Dutch, with textTranslations used in src/layouts/BlogLayoutCenter.astro and src/components/Hero/[hero].astro
 */

/**
 * * Data file configuration for the i18n system
 * Every {Data} key must exist in the below object
 */
import siteDataEn from "./en/siteData.json";
import siteDataNl from "./nl/siteData.json";
import navDataEn from "./en/navData.json";
import navDataNl from "./nl/navData.json";
import faqDataEn from "./en/faqData.json";
import faqDataNl from "./nl/faqData.json";
import teamDataEn from "./en/teamData.json";
import teamDataNl from "./nl/teamData.json";
import testimonialDataEn from "./en/testimonialData.json";
import testimonialDataNl from "./nl/testimonialData.json";

export const dataTranslations = {
  en: {
    siteData: siteDataEn,
    navData: navDataEn,
    faqData: faqDataEn,
    teamData: teamDataEn,
    testimonialData: testimonialDataEn,
  },
  nl: {
    siteData: siteDataNl,
    navData: navDataNl,
    faqData: faqDataNl,
    teamData: teamDataNl,
    testimonialData: testimonialDataNl,
  },
} as const;

/**
 * * Text translations are used with the `useTranslation` function from src/js/i18nUtils.ts to translate various strings on your site.
 *
 * ## Example
 *
 * ```ts
 * import { getLocaleFromUrl } from "@js/localeUtils";
 * import { useTranslations } from "@js/translationUtils";
 * const currLocale = getLocaleFromUrl(Astro.url);
 * const t = useTranslations(currLocale);
 * t("back_to_all_posts"); // this would be "Terug naar alle blogs" if the current locale is "nl"
 * ```
 * or
 * ```ts
 * import { useTranslations } from "@js/translationUtils";
 * const t = useTranslations("nl");
 * t("back_to_all_posts"); // this would be "Trug naar alle artikelen"
 * ```
 */
export const textTranslations = {
  en: {
    hero_description:
      "A template for small business needs. Multiple pages and sections, blog, i18n, animations, CMS - all ready to go.",
    back_to_all_posts: "Back to all posts",
    updated: "Updated",
  },
  nl: {
    hero_description:
      "Dit is een blog van drie broers die schrijven over hun eigen (metale) uitdagingen, om te laten zien dat je er niet alleen voor staat.",
    back_to_all_posts: "Terug naar alle blogs",
    updated: "Update",
  },
} as const;

/**
 * * Route translations are used to translate route names for the language switcher component
 * This can be useful for SEO reasons. The key does not matter, it just needs to match between languages
 *
 * ## Examples
 *
 * These routes must be everything after the base domain. So if this is "site.com/blog", the route would be "blog"
 * Or if this is "ste.com/blog/my-post", the route would be "blog/my-post"
 */
export const routeTranslations = {
  en: {
    aboutKey: "about",
  },
  nl: {
    aboutKey: "over-ons",
  },
} as const;
