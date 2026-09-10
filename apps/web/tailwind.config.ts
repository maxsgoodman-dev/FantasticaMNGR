import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          hover: "var(--surface-hover)",
        },
        border: {
          DEFAULT: "var(--border)",
          hover: "var(--border-hover)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          dim: "var(--accent-dim)",
        },
        ink: {
          primary: "var(--ink-primary)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
        },
        status: {
          win: "var(--status-win)",
          loss: "var(--status-loss)",
          tie: "var(--status-tie)",
        },
        series: {
          opponent: "var(--series-opponent)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
      },
      animation: {
        "live-pulse": "livePulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
