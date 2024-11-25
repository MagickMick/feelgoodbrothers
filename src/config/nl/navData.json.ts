/**
 * * This file is used to define the navigation links for the site.
 * Notes:
 * 1 level of dropdown is supported
 * Mega menus look best with 3-5 columns, but supports anything > 2 columns
 * If using icons, the icon should be saved in the src/icons folder. If filename is "tabler/icon.svg" then input "tabler/icon"
 * Recommend getting icons from https://tabler.io/icons
 */

// utils
import { getAllPosts, countItems, sortByValue } from "@js/blogUtils";
import { humanize } from "@js/textUtils";

// get the categories used in blog posts, to put into navbar
const posts = await getAllPosts("nl");
const allCategories = posts.map((post) => post.data.categories).flat();
const countedCategories = countItems(allCategories);
const processedCategories = sortByValue(countedCategories);

// types
import { type navItem } from "../types/configDataTypes";

// note: 1 level of dropdown is supported
const navConfig: navItem[] = [
  {
    text: "Home",
    link: "http://127.0.0.1:4321/nl/", // wordt https://feelgoodbrothers.com/nl/
  },
  {
    text: "Over ons",
    link: "/over-ons",
  },
  

  // mega menu GEBRUIKEN ALS CATEGORIEN DALIJK TE GROOT WORDEN
  // {
  //   text: "Categorieën",
  //   megaMenuColumns: [
  //     {SZ`
  //       title: "Mentale uitdagingen",
  //       items: [
  //         {
  //           text: "Angst",
  //           link: "/categorieen/angst",
  //         },
  //         {
  //           text: "Paniek aanvallen",
  //           link: "/categorieen/paniek-aanvallen",
  //         },
  //         {
  //           text: "Depressie",
  //           link: "/categorieen/depressie",
  //         },
  //         {
  //           text: "Derealisation",
  //           link: "/categorieen/derealisatie",
  //         },
  //         {
  //           text: "AD(H)D",
  //           link: "/categorieen/adhd",
  //         },
  //       ],
  //     },
  //     {
  //       title: "Zelf hulp",
  //       items: [
  //         {
  //           text: "Mindfullness",
  //           link: "/categorieen/mindfulness",
  //         },
  //         {
  //           text: "Yoga",
  //           link: "/categorieen/yoga",
  //         },
  //         {
  //           text: "Voeding",
  //           link: "/categorieen/voeding",
  //         },
  //       ],
  //     },
  //   ],
  // },

  
   {
     // get the categories used in blog posts, to put into a navbar dropdown
     text: "Categorieën",
     dropdown: processedCategories.map(([category, count]) => {
       return {
         text: humanize(category),
         link: `/categorieen/${category}`,
       };
     }),
   },
];

export default navConfig;
