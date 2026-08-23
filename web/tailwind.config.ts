import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";
import formsPlugin from "@tailwindcss/forms";
import animatePlugin from "tailwindcss-animate";

// content path は CWD 非依存の絶対 path で書く (CLAUDE.md「リポジトリ共通規則」)
const dir = path.dirname(fileURLToPath(import.meta.url));

const config: Config = {
  darkMode: ["class"],
  content: [path.join(dir, "index.html"), path.join(dir, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        blue: {
          "400": "#2589FE",
          "500": "#0070F3",
          "600": "#2F6FEB",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [formsPlugin, animatePlugin],
};
export default config;
