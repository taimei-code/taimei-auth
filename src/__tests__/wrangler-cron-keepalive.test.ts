// Upstash free tier の 30 日無活動アーカイブを防ぐ keep-alive が、wrangler.jsonc の Cron Trigger と
// src/worker.ts の scheduled handler の両方で成立しているかの config invariant。片方だけ消えても
// lint / typecheck / build は緑のまま (cron 無し = 二度と走らない、handler 無し = cron 実行が例外) なので
// 設定を text として読んで drift を検出する (config-invariant-helpers.ts の他 invariant と同型)。

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, REPO_ROOT } from "./config-invariant-helpers";

type WranglerConfig = { triggers?: { crons?: unknown } };

function readCrons(): string[] {
  const text = readFileSync(join(REPO_ROOT, "wrangler.jsonc"), "utf8");
  const config = parseJsonc(text) as unknown as WranglerConfig;
  const crons = config.triggers?.crons;
  return Array.isArray(crons) ? crons.filter((c): c is string => typeof c === "string") : [];
}

describe("Redis keep-alive の Cron Trigger invariant", () => {
  test("wrangler.jsonc に少なくとも週 1 回走る cron がある", () => {
    const crons = readCrons();
    expect(crons.length).toBeGreaterThan(0);
    // 5 field (分 時 日 月 曜日) で、日 field が * = 毎日 (曜日で絞っても週 1 回は走る)。
    // 30 日閾値に対し月 1 回 (日 field 固定) は 1 回の失敗で archive に達するため許さない。
    const atLeastWeekly = crons.filter((cron) => {
      const fields = cron.trim().split(/\s+/);
      return fields.length === 5 && fields[2] === "*";
    });
    expect(atLeastWeekly.length).toBeGreaterThan(0);
  });

  test("src/worker.ts が scheduled handler で keep-alive を呼ぶ", () => {
    const worker = readFileSync(join(REPO_ROOT, "src/worker.ts"), "utf8");
    expect(worker).toMatch(/\bscheduled\s*\(/);
    expect(worker).toContain("touchRedisKeepAlive");
  });
});
