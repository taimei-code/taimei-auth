import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  enabled,
  FEATURE_FLAGS_BINDING,
  FeatureFlags,
  type FlagContext,
  flagContextOf,
  flagshipFeatureFlags,
} from "../feature-flags";

type Call = { readonly defaultValue: boolean; readonly context: Record<string, unknown> };

const bindingAnswering = (answer: () => Promise<{ value: boolean; errorCode?: string }>) => {
  const calls: Call[] = [];
  const binding = {
    getBooleanDetails: (_key: string, defaultValue: boolean, context: Record<string, unknown>) => {
      calls.push({ defaultValue, context });
      return answer();
    },
  };
  return { calls, env: { [FEATURE_FLAGS_BINDING]: binding } as never };
};

const evaluate = (env: never, context: FlagContext = {}) =>
  Effect.runPromise(
    FeatureFlags.use((flags) => flags.isOn("example", context)).pipe(
      Effect.provide(flagshipFeatureFlags(env)),
    ),
  );

describe("actor から評価の context を作る", () => {
  test("actor が無い時と、現在の事業所が無い actor は、空の context になる", () => {
    expect([flagContextOf(undefined), flagContextOf({ lastUsedCompanyId: null })]).toEqual([
      {},
      {},
    ]);
  });

  test("現在の事業所がある actor は、companyId だけを持つ context になる", () => {
    expect(flagContextOf({ lastUsedCompanyId: "c1" })).toEqual({ companyId: "c1" });
  });
});

describe("Flagship での評価", () => {
  test("評価の context をそのまま binding に渡す", async () => {
    const { calls, env } = bindingAnswering(async () => ({ value: true }));
    await evaluate(env);
    await evaluate(env, { companyId: "c1" });
    expect(calls.map(({ context }) => context)).toEqual([{}, { companyId: "c1" }]);
  });

  test("呼び出し側の既定の値は常に off で渡す (無効にした flag が on に倒れない)", async () => {
    const { calls, env } = bindingAnswering(async () => ({ value: true }));
    await evaluate(env);
    expect(calls.map(({ defaultValue }) => defaultValue)).toEqual([false]);
  });

  test("binding の評価が 2 秒たっても終わらなければ、待ち続けずに off にする", async () => {
    const { env } = bindingAnswering(() => new Promise(() => {}));
    expect(await evaluate(env)).toBe(false);
  });

  test("binding の呼び出しが失敗すると、失敗を返さずに off にする", async () => {
    const { env } = bindingAnswering(() => Promise.reject(new Error("flagship is down")));
    expect(await evaluate(env)).toBe(false);
  });
});

describe("機能の code は、フラグの評価の対象どおりに enabled を呼ぶ", () => {
  test("ログイン前にも評価するフラグに actor を渡すと、型検査で落ちる", () => {
    // @ts-expect-error passkey は actor を渡さずに評価する
    const withActor = enabled("passkey", { lastUsedCompanyId: "c1" });

    expect(Effect.isEffect(withActor)).toBe(true);
  });
});
