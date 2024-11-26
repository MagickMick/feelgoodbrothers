import { type SiteDataProps } from "../types/configDataTypes";

// Update this file with your site specific information
const siteData: SiteDataProps = {
  name: "Feelgood Brothers",
  // Your website's title and description (meta fields)
  title:
    "Feelgood Brothers - Persoonlijke blogs over mentaal welzijn",
  description:
    "Ontdek persoonlijke verhalen over mentale uitdagingen van de Feelgood Brothers, vol hoop, steun en manieren om de uitdagingen van het leven aan te gaan.",

  // used on contact page and footer
  contact: {
    heading: "Vragen?",
    email: "info@feelgoodbrothers.com",
  },

  // used on contact page and footer
  story: {
    heading: "Jouw verhaal delen?",
    email: "story@feelgoodbrothers.com",
  },

  // Your information for blog post purposes
  author: {
    name: "Feelgood Brothers",
    email: "info@feelgoodbrothers.com",
    twitter: "Cosmic_Themes",
  },

  // default image for meta tags if the page doesn't have an image already
  defaultImage: {
    src: "/images/cosmic-themes-logo.jpg",
    alt: "Feelgood Brothers logo",
  },
};

export default siteData;
