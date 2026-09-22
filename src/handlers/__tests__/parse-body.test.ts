import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { parseZodBody, parseZodBodyWithDetails } from "../parse-body";

// 400 への変換は adapter (run-route.ts) の責務で、account-routes-migrated.test.ts が検証する。
// ここは Effect が返す data と InvalidArgument.details のユニット境界だけを固定する (AC-035)。

const schema = z.object({ name: z.string().min(1) });
const renamed = schema.transform((d) => ({ upper: d.name.toUpperCase() }));

type ParseResult = { ok: true; data: unknown } | { ok: false; details?: unknown } | { ok: false };

const runParse = async (
  body: BodyInit | null,
  parse: typeof parseZodBody = parseZodBody,
  target: z.ZodType = schema,
): Promise<ParseResult> => {
  const app = new Hono();
  let captured: ParseResult | null = null;
  app.post("/t", async (c) => {
    captured = await Effect.runPromise(
      Effect.match(parse(c, target), {
        onFailure: (e) =>
          e.details === undefined
            ? { ok: false as const }
            : { ok: false as const, details: e.details },
        onSuccess: (data) => ({ ok: true as const, data }),
      }),
    );
    return c.json({ ok: true });
  });
  await app.request("/t", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
  if (captured === null) throw new Error("parse callback was not invoked");
  return captured;
};

describe("parseZodBody", () => {
  test("schema 適合 body は ok:true + data を返す", async () => {
    const result = await runParse(JSON.stringify({ name: "taro" }));
    expect(result).toEqual({ ok: true, data: { name: "taro" } });
  });

  test("schema の transform を通した値を data に返す", async () => {
    const result = await runParse(JSON.stringify({ name: "taro" }), parseZodBody, renamed);
    expect(result).toEqual({ ok: true, data: { upper: "TARO" } });
  });

  test("invalid JSON body は ok:false (details 無し)", async () => {
    const result = await runParse("{not-json");
    expect(result).toEqual({ ok: false });
  });

  test("invalid JSON body は parseZodBodyWithDetails では details 付き ok:false (safeParse(null) の flatten)", async () => {
    const result = await runParse("{not-json", parseZodBodyWithDetails);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("details" in result && result.details).toBeTruthy();
    }
  });

  test("schema 不適合 body は parseZodBodyWithDetails では details 付き ok:false", async () => {
    const result = await runParse(JSON.stringify({ name: "" }), parseZodBodyWithDetails);
    expect(result.ok).toBe(false);
    if (!result.ok && "details" in result) {
      expect(result.details).toHaveProperty("fieldErrors");
    }
  });

  test("空 body (Content-Length: 0) は ok:false", async () => {
    const result = await runParse(null);
    expect(result).toEqual({ ok: false });
  });
});
