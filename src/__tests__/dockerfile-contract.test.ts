// Dockerfile の stage 構成 (install layer の入力 / COPY 順 / 既定 build target) を text として読む
// config invariant。stage 分離の正本: docs/adr/0014-docker-runner-dev-stage-separation.md

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dockerfileViolations, REPO_ROOT, workspacePackageNames } from "./config-invariant-helpers";

describe("Dockerfile stage 契約の config invariant", () => {
  test("QA-M-12: Dockerfile の regression 4 種 (manifests COPY / workspace manifest 漏れ / deps 順序 / 最終 stage) を検出する", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
    const packages = workspacePackageNames();
    expect(packages).toContain("auth-client");
    expect(dockerfileViolations(dockerfile, packages)).toEqual([]);

    // manifest 以外の COPY は source 名も flag も問わず違反 (allowlist 判定であることの確認)。
    for (const injected of [
      "COPY packages ./packages",
      "COPY --chown=bun:bun packages ./packages",
      "COPY . .",
      "COPY tsconfig.json ./",
      "COPY db ./db",
    ]) {
      const manifestsRegression = dockerfile.replace(
        "COPY packages/auth-client/package.json ./packages/auth-client/package.json",
        `COPY packages/auth-client/package.json ./packages/auth-client/package.json\n${injected}`,
      );
      expect(dockerfileViolations(manifestsRegression, packages).join("\n")).toContain(
        "manifests stage が manifest 以外を COPY している",
      );
    }

    // workspace package を足したのに manifests stage の COPY を足し忘れた場合 (足す 1 行を message に含める)。
    const missingManifestCopy = dockerfile.replace(
      "COPY packages/auth-client/package.json ./packages/auth-client/package.json\n",
      "",
    );
    expect(dockerfileViolations(missingManifestCopy, packages).join("\n")).toContain(
      "COPY packages/auth-client/package.json ./packages/auth-client/package.json",
    );

    const orderRegression = dockerfile
      .replace(/^COPY packages \.\/packages$/m, "")
      .replace(
        /^(RUN --mount=type=cache[^\n]*bun install[^\n]*)$/m,
        "COPY packages ./packages\n$1",
      );
    expect(dockerfileViolations(orderRegression, packages).join("\n")).toContain(
      "COPY packages ./packages が bun install より前",
    );

    // 最終 stage が dev でない書き方は、名前付き / 名前なし / flag 付き / 小文字 as / 行末コメントの
    // どれでも検出する (`^FROM \S+ AS \S+$` 決め打ちだと後ろ 4 つが「FROM 行でない」扱いで素通りする)。
    for (const appended of [
      "FROM runner AS release",
      "FROM runner",
      "FROM --platform=linux/amd64 runner AS release",
      "FROM runner as release",
      "FROM runner AS release # 本番 image",
    ]) {
      expect(dockerfileViolations(`${dockerfile}\n${appended}\n`, packages).join("\n")).toContain(
        "Dockerfile の最後の stage が dev でない",
      );
    }
    // 同じ表記ゆれを最終 dev stage 側に入れても違反にならない (偽陽性の positive control)。
    const tolerantDev = dockerfile.replace(
      /^FROM web-build AS dev$/m,
      "FROM web-build as dev # 既定 target",
    );
    expect(tolerantDev).not.toBe(dockerfile);
    expect(dockerfileViolations(tolerantDev, packages)).toEqual([]);
  });
});
