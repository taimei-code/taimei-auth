import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, repoFiles } from "./source-scan";

const CONSUMER_KNOWLEDGE = [/\btaimei\b(?!-)/, /app\.taimei-code\./, /callbackUrl/];

const mentionsConsumer = (line: string) => CONSUMER_KNOWLEDGE.some((pattern) => pattern.test(line));

describe("auth-client は taimei-auth の決めごとだけを持ち、consumer の知識を持たない", () => {
  test("SDK の code・試験・文書に、consumer の名前・host・path が出てこない", () => {
    const files = repoFiles("packages/auth-client", ":!packages/auth-client/src/gen");
    expect(files.length).toBeGreaterThan(10);

    const hits = files.flatMap((file) =>
      readFileSync(join(REPO_ROOT, file), "utf8")
        .split("\n")
        .flatMap((line, index) => (mentionsConsumer(line) ? [`${file}:${index + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  test.each([
    'service: "taimei"',
    "consumer は taimei だけ",
    "taimei-code/taimei#628",
    "https://app.taimei-code.com/",
    "/auth?callbackUrl=",
  ])("consumer の知識 %s を見つける", (line) => {
    expect(mentionsConsumer(line)).toBe(true);
  });

  test.each([
    "taimei-auth の決めごと",
    "@taimei-code/auth-client",
    "https://auth.taimei-code.com",
    "taimei-code/taimei-auth",
  ])("taimei-auth の名前と package 名 %s は見逃す", (line) => {
    expect(mentionsConsumer(line)).toBe(false);
  });
});
