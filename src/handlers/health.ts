import { Effect } from "effect";
import { type Context, Hono } from "hono";

import { probeHealth } from "../health/probe";
import { runRoute } from "./run-route";

export const healthProgram = Effect.fn("handlers.health")(function* (c: Context) {
  const report = yield* probeHealth();
  const version = process.env.CF_VERSION_ID ?? null;
  return c.json({ ...report, version }, report.status === "ok" ? 200 : 503);
});

export const health = new Hono();

health.get("/health", (c) => runRoute(c, healthProgram(c)));
