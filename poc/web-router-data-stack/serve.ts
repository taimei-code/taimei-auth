import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const root = path.relative(process.cwd(), path.join(import.meta.dir, "dist", process.env.APP ?? "tsr-atom"));
const app = new Hono();
// ADR-0002 と同じ規則: /auth/* は serveStatic、拡張子の無い /account/* は index.html
app.use("/auth/*", serveStatic({ root, rewriteRequestPath: (p) => p.replace(/^\/auth/, "") }));
app.get("/auth/*", serveStatic({ root, path: "index.html" }));
app.get("/account/*", (c, next) =>
  /\.[a-zA-Z0-9]+$/.test(c.req.path) ? c.notFound() : serveStatic({ root, path: "index.html" })(c, next),
);

export default { port: 5198, fetch: app.fetch };
