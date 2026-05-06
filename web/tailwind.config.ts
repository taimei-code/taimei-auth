import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";
import formsPlugin from "@tailwindcss/forms";
import animatePlugin from "tailwindcss-animate";

// taimei (Next.js) と同等の shadcn/ui デザイントークンを Layer B (Vite + React) に移植。
// content path のみ web/ 配下に調整。CSS variables (--background, --primary 等) は
// src/index.css から提供する shadcn/ui 標準パターン。
//
// content の絶対 path 化: Tailwind v3 は content の相対 path を CWD 基準で解決する。
// 本プロジェクトは taimei-auth root から `vite build --config web/vite.config.ts` を実行
// するため、相対 path だと taimei-auth/src を読みに行き web/src/* の class が一切拾われない
// (pre-existing bug)。__dirname (= web/) からの絶対 path に揃えて CWD に依存させない。
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
