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
import teamDataEn from "./en/teamData.json";
import teamDataNl from "./nl/teamData.json";

export const dataTranslations = {
  en: {
    siteData: siteDataEn,
    navData: navDataEn,
    teamData: teamDataEn,
  },
  nl: {
    siteData: siteDataNl,
    navData: navDataNl,
    teamData: teamDataNl,
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
 * t("back_to_all_posts"); // this would be "Terug naar alle artikelen"
 * ```
 */
export const textTranslations = {
  en: {
    hero_description:
      "Three brothers share their experiences with mental issues and how they cope with them. Read along and discover that you’re not alone in this.",
    back_to_all_posts: "Back to all posts",
    updated: "Updated",
    home: "Home",
    blog: "Blog",
    categories: "Categories",
    related_posts: "Read more stories like this",
    written_by: "Written by",
    min_read: "min read",
    posts_by: "Stories by",
    comments: "Comments",
    guest_story: "Guest story",
    by: "by",
    guest_shared_by: "This story was shared by",
    guest_shared_by_suffix: ", a member of our community. Names are first names or pseudonyms.",
    share_your_story: "Want to share your story too? Email us at",
    disclaimer_title: "Not medical advice",
    disclaimer_text:
      "This is a personal experience, not professional advice. Do you recognize yourself in this story? It can really help to talk to your doctor or a mental health professional. You don't have to figure it out on your own.",
  },
  nl: {
    hero_description:
      "Drie broers delen hun ervaringen met mentale uitdagingen en hoe ze ermee omgaan. Lees mee en ontdek dat ook jij er niet alleen voor staat.",
    back_to_all_posts: "Terug naar alle blogs",
    updated: "Update",
    home: "Home",
    blog: "Blog",
    categories: "Categorieën",
    related_posts: "Lees meer verhalen zoals dit",
    written_by: "Geschreven door",
    min_read: "min leestijd",
    posts_by: "Verhalen van",
    comments: "Reacties",
    guest_story: "Gastblog",
    by: "door",
    guest_shared_by: "Dit verhaal is gedeeld door",
    guest_shared_by_suffix: " uit onze community. We gebruiken alleen een voornaam of pseudoniem.",
    share_your_story: "Wil jij ook je verhaal delen? Mail ons via",
    disclaimer_title: "Geen medisch advies",
    disclaimer_text:
      "Dit is een persoonlijke ervaring, geen professioneel advies. Herken je jezelf in dit verhaal? Dan kan het goed zijn om professionele hulp te zoeken, bijvoorbeeld via je huisarts. Je hoeft het niet alleen uit te zoeken.",
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
    categorieKey: "categories",
    blogKey: "blog",
  },
  nl: {
    aboutKey: "over-ons",
    categorieKey: "categorieen",
    blogKey: "blog",
  },
} as const;
