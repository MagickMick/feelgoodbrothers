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
const posts = await getAllPosts("en");
const allCategories = posts.map((post) => post.data.categories).flat();
const countedCategories = countItems(allCategories);
const processedCategories = sortByValue(countedCategories);

// types
import { type navItem } from "../types/configDataTypes";

// note: 1 level of dropdown is supported
const navConfig: navItem[] = [
  {
    text: "Home",
    link: "https://feelgoodbrothers.com"
  },
  {
    text: "About us",
    link: "/about",
  },
  

  // mega menu GEBRUIKEN ALS CATEGORIEN DALIJK TE GROOT WORDEN
  // {
  //   text: "Categories",
  //   megaMenuColumns: [
  //     {SZ`
  //       title: "Mental issues",
  //       items: [
  //         {
  //           text: "Anxiety",
  //           link: "/categories/anxiety",
  //         },
  //         {
  //           text: "Panic Attacks",
  //           link: "/categories/panic-attacks",
  //         },
  //         {
  //           text: "Depression",
  //           link: "/categories/depression",
  //         },
  //         {
  //           text: "Derealisation",
  //           link: "/categories/derealisation",
  //         },
  //         {
  //           text: "AD(H)D",
  //           link: "/categories/adhd",
  //         },
  //       ],
  //     },
  //     {
  //       title: "Self-care",
  //       items: [
  //         {
  //           text: "Mindfullness",
  //           link: "/categories/mindfulness",
  //         },
  //         {
  //           text: "Yoga",
  //           link: "/categories/yoga",
  //         },
  //         {
  //           text: "Nutrition",
  //           link: "/categories/nutrition",
  //         },
  //       ],
  //     },
  //   ],
  // },

  
   {
     // get the categories used in blog posts, to put into a navbar dropdown
     text: "Categories",
     dropdown: processedCategories.map(([category, count]) => {
       return {
         text: humanize(category),
         link: `/categories/${category}`,
       };
     }),
   },
];

export default navConfig;
