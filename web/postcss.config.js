import path from "node:path";
import { fileURLToPath } from "node:url";

// root からの vite build では PostCSS の CWD が root になり、相対パスだと tailwind.config.ts を見失う
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: path.resolve(__dirname, "tailwind.config.ts") },
    autoprefixer: {},
  },
};
