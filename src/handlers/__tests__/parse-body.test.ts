import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { parseZodBody } from "../parse-body";

// parseZodBody は Hono Context に依存するため、実 route 経由で callback を実行して検証する。
// 400 への変換は呼び出し元 route の責務 (account-routes-migrated.test.ts がカバー) で、
// ここは callback が返す { ok, data, details } のユニット境界のみを固定する。

const schema = z.object({ name: z.string().min(1) });

type ParseResult = { ok: true; data: unknown } | { ok: false; details?: unknown } | { ok: false };

const runParse = async (
  body: BodyInit | null,
  opts: { withDetails?: boolean; transform?: (d: z.infer<typeof schema>) => unknown } = {},
  headers: Record<string, string> = { "content-type": "application/json" },
): Promise<ParseResult> => {
  const app = new Hono();
  let captured: ParseResult | null = null;
  app.post("/t", async (c) => {
    captured = await parseZodBody(c, schema, opts)();
    return c.json({ ok: true });
  });
  await app.request("/t", { method: "POST", body, headers });
  if (captured === null) throw new Error("parse callback was not invoked");
  return captured;
};

describe("parseZodBody", () => {
  test("schema 適合 body は ok:true + data を返す", async () => {
    const result = await runParse(JSON.stringify({ name: "taro" }));
    expect(result).toEqual({ ok: true, data: { name: "taro" } });
  });

  test("transform 指定時は適用後の値を data に返す", async () => {
    const result = await runParse(JSON.stringify({ name: "taro" }), {
      transform: (d) => ({ upper: d.name.toUpperCase() }),
    });
    expect(result).toEqual({ ok: true, data: { upper: "TARO" } });
  });

  test("invalid JSON body は ok:false (details 無し)", async () => {
    const result = await runParse("{not-json");
    expect(result).toEqual({ ok: false });
  });

  test("invalid JSON body + withDetails=true は details 付き ok:false (safeParse(null) の flatten)", async () => {
    const result = await runParse("{not-json", { withDetails: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("details" in result && result.details).toBeTruthy();
    }
  });

  test("schema 不適合 body + withDetails=true は details 付き ok:false", async () => {
    const result = await runParse(JSON.stringify({ name: "" }), { withDetails: true });
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
