import { getTranslatedData } from "@js/translationUtils";
import { getCategoriesCached, categoryName, categorySlug } from "@js/blogUtils";
import { type Locale } from "@js/localeUtils";
import { type navItem } from "@config/types/configDataTypes";

/** static nav items + a "Categories" dropdown built from categories that have live posts */
export async function getNavData(locale: Locale): Promise<navItem[]> {
  const base = getTranslatedData("navData", locale) as navItem[];
  const cats = await getCategoriesCached(locale);
  if (cats.length === 0) return base;
  const segment = locale === "nl" ? "categorieen" : "categories";
  return [
    ...base,
    {
      text: locale === "nl" ? "Categorieën" : "Categories",
      dropdown: cats.map((c) => ({
        text: categoryName(locale, c),
        link: `/${segment}/${categorySlug(locale, c)}/`,
      })),
    },
  ];
}
