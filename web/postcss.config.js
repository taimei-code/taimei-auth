import path from "node:path";
import { fileURLToPath } from "node:url";

// `vite build --config web/vite.config.ts` を taimei-auth の root から実行すると、
// PostCSS の CWD は taimei-auth/ になり、tailwind が web/tailwind.config.ts を見つけられない。
// 絶対パスで明示し、実行時の CWD に依存せず解決できるようにする。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: path.resolve(__dirname, "tailwind.config.ts") },
    autoprefixer: {},
  },
};
