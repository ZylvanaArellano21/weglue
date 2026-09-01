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
        teal: "#0FA6A6",
        cream: "#FEFCF0",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        zain: ["var(--font-zain)", "serif"],
        inter: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Shared card depth — the web half of the one card-depth system
        // (mobile: components/shared/cardStyles.ts). ~3px offset, ~12px blur,
        // ~9% black. Restrained: no heavy border, no strong floating shadow.
        card: "0 3px 12px rgba(0, 0, 0, 0.09)",
      },
    },
  },
  plugins: [],
};

export default config;
