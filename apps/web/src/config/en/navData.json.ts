/**
 * Static navigation links. The "Categories" dropdown is added at request time
 * from the database (see src/js/navUtils.ts).
 * Internal links are written without locale; NavLink adds /nl when needed.
 */
import { type navItem } from "../types/configDataTypes";

const navConfig: navItem[] = [
  {
    text: "Home",
    link: "/",
  },
  {
    text: "About us",
    link: "/about/",
  },
];

export default navConfig;
