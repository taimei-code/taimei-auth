import { createHash, timingSafeEqual } from "node:crypto";
import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client";
import type { Hono } from "hono";
import { CookieHeader, GetSessionResult } from "./consumer-rpc-contract";
import { getSessionByCookie, rpc } from "./consumer-rpc";
import { handleRpc } from "./fetch-handler";
import { runRpc } from "./run-rpc";

const getSessionRpc = rpc(CookieHeader, GetSessionResult, getSessionByCookie);

const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());

const pocTokenMatches = (presented: string | undefined) => {
  const expected = process.env.POC_TOKEN;
  return !!expected && !!presented && timingSafeEqual(digest(expected), digest(presented));
};

const CONNECT_PATH = {
  "v1-verify": "/rpc/auth.v1.AuthService/VerifySession",
  "v1-list": "/rpc/auth.v1.AuthService/ListCurrentCompanyMembers",
} as const;

export function mountPocMeasure(app: Hono): void {
  app.post("/poc/measure/:mode", async (c) => {
    if (!pocTokenMatches(c.req.header("X-Poc-Token"))) return c.notFound();
    const cookieHeader = await c.req.text();
    const mode = c.req.param("mode");
    if (mode === "v3") return c.json(await runRpc(getSessionRpc(cookieHeader)));
    if (mode === "v1-verify" || mode === "v1-list") {
      const url = new URL(c.req.url);
      url.pathname = CONNECT_PATH[mode];
      const sessionToken = extractSessionTokenFromCookieHeader(cookieHeader) ?? "";
      const response = await handleRpc(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionToken }),
        }),
      );
      return response ?? c.notFound();
    }
    return c.notFound();
  });
}
