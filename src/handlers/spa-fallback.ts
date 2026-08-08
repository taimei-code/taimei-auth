import type { Context } from "hono";

const ASSET_PATH_PATTERN = /\.[a-zA-Z0-9]+$/;

export const buildSpaFallbackHandler = (indexHtmlPath: string) => {
  const file = Bun.file(indexHtmlPath);
  return async (c: Context) => {
    if (ASSET_PATH_PATTERN.test(new URL(c.req.url).pathname)) {
      return c.notFound();
    }
    return new Response(file, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  };
};
