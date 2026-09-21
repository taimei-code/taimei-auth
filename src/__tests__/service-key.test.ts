import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  getValidServiceKeys,
  ServiceKeyMisconfigured,
  ServiceKeyRejected,
  verifyServiceKey,
} from "../service-key";
import { grepFiles } from "./grep-files";

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

  test("AC-001: active と一致 → 通す", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    expect(Effect.runSync(verifyServiceKey("active-key"))).toBeUndefined();
  });

  test("AC-002: previous と一致 → 通す", () => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    expect(Effect.runSync(verifyServiceKey("previous-key"))).toBeUndefined();
  });

  test("AC-003: previous のみ + production → 通す (503 にしない)", () => {
    process.env.AUTH_SERVICE_KEY_PREVIOUS = "previous-key";
    process.env.APP_ENV = "production";
    expect(Effect.runSync(verifyServiceKey("previous-key"))).toBeUndefined();
  });

  test.each([
    ["AC-004", "wrong-key"],
    ["AC-005", undefined],
    ["AC-006", ""],
  ])("%s: 提示 %j → ServiceKeyRejected (401)", (_, presented) => {
    process.env.AUTH_SERVICE_KEY = "active-key";
    const failure = rejected(presented);
    expect(failure).toBeInstanceOf(ServiceKeyRejected);
    expect(failure.error).toBe("Unauthorized: invalid service key");
    expect(failure.status).toBe(401);
  });

  test("AC-007/008: 未設定 + production → ServiceKeyMisconfigured (503)、warn なし (workerd には index.ts の boot guard が無く、request 時のこの判定が唯一の防御)", () => {
    process.env.APP_ENV = "production";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failure = rejected("any");
      expect(failure).toBeInstanceOf(ServiceKeyMisconfigured);
      expect(failure.error).toBe("Service Key not configured (production)");
      expect(failure.status).toBe(503);
      expect(warn).toHaveBeenCalledTimes(0);
    } finally {
      warn.mockRestore();
    }
  });

  test.each([
    ["AC-009", "development"],
    ["AC-010", undefined],
    ["AC-011", "staging"],
  ])("%s: 未設定 + APP_ENV=%s → 通す + warn 1 回", (_, appEnv) => {
    if (appEnv !== undefined) process.env.APP_ENV = appEnv;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(Effect.runSync(verifyServiceKey(undefined))).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "AUTH_SERVICE_KEY is not configured. Skipping service auth (non-production only).",
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("service key の封じ込め (静的 tripwire)", () => {
  test("AC-023: AUTH_SERVICE_KEY の読み手は service-key.ts と index.ts の boot guard だけ", () => {
    expect(
      grepFiles("process\\.env\\.AUTH_SERVICE_KEY", "src", { excludeTests: true }).sort(),
    ).toEqual(["src/index.ts", "src/service-key.ts"]);
  });

  test("AC-035: 鍵の比較は timingSafeEqual (digest 経由) だけで、includes / === を使わない", () => {
    expect(grepFiles("timingSafeEqual\\(", "src/service-key.ts", { lines: true })).toHaveLength(1);
    expect(grepFiles("\\.includes\\(|=== presented|presented ===", "src/service-key.ts")).toEqual(
      [],
    );
  });

  test("AC-024: X-Service-Key header の読み手は app.ts の /rpc/* middleware 1 行だけ", () => {
    const hits = grepFiles('c\\.req\\.header\\("X-Service-Key"\\)', "src", {
      excludeTests: true,
      lines: true,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("src/app.ts");
  });

  test("AC-033: 手書きの応答 body (c.json({ error:) は production src に無い", () => {
    expect(
      grepFiles("c\\.json\\([[:space:]]*\\{[[:space:]]*error", "src", {
        excludeTests: true,
        lines: true,
      }),
    ).toEqual([]);
  });
});
