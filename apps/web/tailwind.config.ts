import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          sunken: "var(--surface-sunken)",
          raised: "var(--surface-2)",
          "raised-2": "var(--surface-3)",
          hover: "var(--surface-hover)",
        },
        border: {
          DEFAULT: "var(--border)",
          hover: "var(--border-hover)",
          highlight: "var(--border-highlight)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          dim: "var(--accent-dim)",
          bright: "var(--accent-bright)",
          glow: "var(--accent-glow)",
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
        raised: "var(--shadow-raised)",
        popover: "var(--shadow-popover)",
      },
      backgroundImage: {
        "panel-gradient": "linear-gradient(180deg, var(--surface-2) 0%, var(--surface) 100%)",
        "panel-gradient-hover": "linear-gradient(180deg, var(--surface-3) 0%, var(--surface-2) 100%)",
        "sunken-gradient": "linear-gradient(180deg, var(--surface) 0%, var(--surface-sunken) 100%)",
        "topbar-gradient": "linear-gradient(180deg, var(--surface-2) 0%, var(--surface) 100%)",
        "accent-gradient": "linear-gradient(135deg, var(--accent-bright) 0%, var(--accent) 55%, var(--accent-dim) 100%)",
      },
      animation: {
        "live-pulse": "livePulse 1.6s ease-in-out infinite",
        "glow-pulse": "glowPulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
