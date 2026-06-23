import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fdf4ff",
          100: "#fae8ff",
          200: "#f3d0fe",
          300: "#e9a8fd",
          400: "#d876fa",
          500: "#c044f0",
          600: "#a627d4",
          700: "#8b1daf",
          800: "#731a8f",
          900: "#601974",
          950: "#3f0550",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
