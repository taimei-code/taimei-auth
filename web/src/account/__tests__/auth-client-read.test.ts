import { afterEach, expect, test } from "bun:test";
import { Effect, Exit } from "effect";

import { listLinkedAccounts, listSessions } from "../auth-client-read";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const respondWith = (status: number, body: unknown) => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    { preconnect: originalFetch.preconnect },
  );
};

const READS: Array<{ name: string; run: () => Promise<Exit.Exit<unknown, unknown>> }> = [
  { name: "セッション", run: () => Effect.runPromiseExit(listSessions) },
  { name: "連携アカウント", run: () => Effect.runPromiseExit(listLinkedAccounts) },
];

test.each(
  READS,
)("better-auth が失敗の応答を返すと、$name の一覧の読み出しは空の一覧で成功せず失敗する", async ({
  run,
}) => {
  respondWith(500, { message: "Internal Server Error" });
  expect(Exit.isFailure(await run())).toBe(true);
});

test.each(READS)("better-auth が一覧を返すと、$name の一覧の読み出しはその一覧で成功する", async ({
  run,
}) => {
  respondWith(200, []);
  expect(await run()).toEqual(Exit.succeed([]));
});
