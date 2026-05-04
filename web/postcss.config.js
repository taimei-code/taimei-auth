import path from "node:path";
import { fileURLToPath } from "node:url";

// `vite build --config web/vite.config.ts` を taimei-auth root から実行する場合、
// PostCSS の CWD は taimei-auth/ となり tailwind が web/tailwind.config.ts を発見できない。
// 絶対 path で明示することで実行 CWD に依存せず確実に解決させる。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: path.resolve(__dirname, "tailwind.config.ts") },
    autoprefixer: {},
  },
};
