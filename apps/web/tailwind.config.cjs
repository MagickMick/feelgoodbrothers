/** @type {import('tailwindcss').Config} */

const colors = require("tailwindcss/colors");

module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    screens: {
      xs: "400px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        // use any standard tailwind colors from here https://tailwindcss.com/docs/customizing-colors
        // or generate with https://uicolors.app/create
        // primary: {
        //   50: "#eaffff",
        //   100: "#cbfeff",
        //   200: "#9efaff",
        //   300: "#5bf3ff",
        //   400: "#00e1ff",
        //   500: "#00c5e5",
        //   600: "#009dc0",
        //   700: "#037c9b",
        //   800: "#0d647d",
        //   900: "#105269",
        //   950: "#033649",
        // },
        primary: colors.orange,
        base: colors.neutral,
        info: "#7dd3fc",
        "info-content": "#082f49",
        success: "#6ee7b7",
        "success-content": "#022c22",
        warning: "#fcd34d",
        "warning-content": "#111827",
        error: "#fca5a5",
        "error-content": "#450a0a",
      },
      animation: {
        marquee: "marquee 100s linear infinite",
      },
      keyframes: {
        marquee: {
          from: {
            transform: "translateX(0)",
          },
          to: {
            transform: "translateX(calc(-100% - 2.5rem))",
          },
        },
      },
    },
    fontFamily: {
      sans: [
        "Poppins",
        "BlinkMacSystemFont",
        "-apple-system",
        "Segoe UI",
        "Roboto",
        "Helvetica",
        "Arial",
        "sans-serif",
        "Apple Color Emoji",
        "Segoe UI Emoji",
        "Segoe UI Symbol",
      ],
      serif: [
        "Iowan Old Style",
        "Apple Garamond",
        "Baskerville",
        "Times New Roman",
        "Droid Serif",
        "Times",
        "Source Serif Pro",
        "serif",
        "Apple Color Emoji",
        "Segoe UI Emoji",
        "Segoe UI Symbol",
      ],
      mono: [
        "SFMono-Regular",
        "Menlo",
        "Monaco",
        "Consolas",
        "Liberation Mono",
        "Courier New",
        "monospace",
      ],
    },
  },
  plugins: [require("@tailwindcss/typography"), require("@tailwindcss/forms")],
};
