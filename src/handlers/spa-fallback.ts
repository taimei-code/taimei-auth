import type { Context } from "hono";

const HAS_EXTENSION = /\.[a-zA-Z0-9]+$/;

export const buildSpaFallbackHandler = (indexHtmlPath: string) => {
  const file = Bun.file(indexHtmlPath);
  return async (c: Context) => {
    if (HAS_EXTENSION.test(new URL(c.req.url).pathname)) {
      return c.notFound();
    }
    return new Response(file, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  };
};
