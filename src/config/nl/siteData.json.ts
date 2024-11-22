import { type SiteDataProps } from "../types/configDataTypes";

// Update this file with your site specific information
const siteData: SiteDataProps = {
  name: "Dutch Stellar",
  // Your website's title and description (meta fields)
  title:
    "Nederlands Stellar - a small business theme and landing page crafted with Astro and Tailwind CSS",
  description:
    "Create an amazing website for your small business clients with our beautiful website theme designed using Astro and Tailwind CSS. Perfect for freelancers, developers, startups, and personal use.",

  // used on contact page and footer
  contact: {
    address1: "Straatnaam 123",
    address2: "1234AB Amsterdam",
    phone: "06-12345678",
    email: "info@feelgoodbrothers.com",
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
