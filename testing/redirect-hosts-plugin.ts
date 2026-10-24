import path from "node:path";
import { plugin } from "bun";

const nonProductionRedirectHosts = path.join(import.meta.dir, "redirect-hosts.ts");

plugin({
  name: "non-production-redirect-hosts",
  setup(build) {
    build.onLoad({ filter: /\/src\/redirect-hosts\.ts$/ }, async () => ({
      contents: await Bun.file(nonProductionRedirectHosts).text(),
      loader: "ts",
    }));
  },
});
