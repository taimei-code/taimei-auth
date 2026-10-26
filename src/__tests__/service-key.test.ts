import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  getValidServiceKeys,
  ServiceKeyMisconfigured,
  ServiceKeyRejected,
  verifyServiceKey,
} from "../service-key";
import { grepFiles, grepLines } from "./source-scan";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.AUTH_SERVICE_KEY;
  delete process.env.AUTH_SERVICE_KEY_PREVIOUS;
  delete process.env.APP_ENV;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("getValidServiceKeys", () => {
  test("active のみ set → active 1 個", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    expect(getValidServiceKeys()).toEqual(["active-key"]);
  });

  test("active + previous 両方 set → 2 個", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(getValidServiceKeys()).toEqual(["active-key", "previous-key"]);
  });

  test("previous のみ set → previous 1 個 (運用上想定外だが safe)", () => {
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(getValidServiceKeys()).toEqual(["previous-key"]);
  });

  test("両方 unset → 空配列", () => {
    expect(getValidServiceKeys()).toEqual([]);
  });
});

describe("verifyServiceKey", () => {
  const rejected = (presented: string | undefined) =>
    Effect.runSync(Effect.flip(verifyServiceKey(presented)));

  test("active と一致 → 通す", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    expect(Effect.runSync(verifyServiceKey("active-key"))).toBeUndefined();
  });

  test("previous と一致 → 通す", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(Effect.runSync(verifyServiceKey("previous-key"))).toBeUndefined();
  });

  test("previous のみ → 通す (503 にしない)", () => {
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(Effect.runSync(verifyServiceKey("previous-key"))).toBeUndefined();
  });

  test.each([
    ["鍵が違う", "wrong-key"],
    ["鍵が無い", undefined],
    ["鍵が空文字", ""],
  ])("%s (提示 %j) と ServiceKeyRejected (401) を返す", (_, presented) => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    const failure = rejected(presented);
    expect(failure).toBeInstanceOf(ServiceKeyRejected);
  });

  test.each([
    ["production の時", "production"],
    ["development の時", "development"],
    ["APP_ENV が無い時", undefined],
    ["staging の時", "staging"],
  ])("%s も、鍵が未設定なら ServiceKeyMisconfigured (503) を返し、warn を出さない (APP_ENV=%s)", (_, appEnv) => {
    if (appEnv !== undefined) process.env.APP_ENV = appEnv;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(rejected(undefined)).toBeInstanceOf(ServiceKeyMisconfigured);
      expect(warn).toHaveBeenCalledTimes(0);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("service key の封じ込め (静的 tripwire)", () => {
  test("AUTH_SERVICE_KEY の読み手は service-key.ts と Bun の入口 (testing/server.ts) の boot guard だけ", () => {
    expect(
      grepFiles("process\\.env\\.AUTH_SERVICE_KEY", ["src", "testing"], {
        tests: "exclude",
      }).sort(),
    ).toEqual(["src/service-key.ts", "testing/server.ts"]);
  });

  test("鍵の比較は timingSafeEqual (digest 経由) だけで、includes / === を使わない", () => {
    expect(grepLines("timingSafeEqual\\(", "src/service-key.ts", {})).toHaveLength(1);
    expect(grepFiles("\\.includes\\(|=== presented|presented ===", "src/service-key.ts")).toEqual(
      [],
    );
  });

  test("X-Service-Key header の読み手は app.ts の /rpc/* middleware 1 行だけ", () => {
    const hits = grepLines('c\\.req\\.header\\("X-Service-Key"\\)', "src", {
      tests: "exclude",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("src/app.ts");
  });

  test("手書きの応答 body (c.json({ error:) は production src に無い", () => {
    expect(
      grepLines("c\\.json\\([[:space:]]*\\{[[:space:]]*error", "src", {
        tests: "exclude",
      }),
    ).toEqual([]);
  });
});
