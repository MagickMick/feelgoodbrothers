import { type SiteDataProps } from "../types/configDataTypes";

// Update this file with your site specific information
const siteData: SiteDataProps = {
  name: "Feelgood Brothers",
  // Your website's title and description (meta fields)
  title:
    "Feelgood Brothers - Personal stories of mental health",
  description:
    "Discover personal stories of mental health struggles from the Feelgood Brothers, sharing hope, support, and ways to navigate life's challenges.",

  // used on contact page and footer
  contact: {
    heading: "Questions?",
    email: "info@feelgoodbrothers.com",
  },

  // used on contact page and footer
  story: {
    heading: "Share your story?",
    email: "story@feelgoodbrothers.com",
  },

  // Your information for blog post purposes
  author: {
    name: "Feelgood Brothers",
    email: "info@feelgoodbrothers.com",
    twitter: "none",
  },

  // default image for meta tags if the page doesn't have an image already
  defaultImage: {
    src: "/images/cosmic-themes-logo.jpg",
    alt: "Feelgood Brothers logo",
  },
};

export default siteData;
