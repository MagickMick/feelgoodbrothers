/**
 * Static navigation links. The "Categorieën" dropdown is added at request time
 * from the database (see src/js/navUtils.ts).
 * Internal links are written without locale; NavLink adds /nl when needed.
 */
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "Home",
    link: "/nl/",
  },
  {
    text: "Over ons",
    link: "/over-ons/",
  },
];

export default navConfig;
