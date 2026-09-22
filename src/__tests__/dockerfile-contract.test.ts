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

    for (const appended of [
      "FROM base AS release",
      "FROM base",
      "FROM --platform=linux/amd64 base AS release",
      "FROM base as release",
      "FROM base AS release # 本番 image",
    ]) {
      expect(dockerfileViolations(`${dockerfile}\n${appended}\n`, packages).join("\n")).toContain(
        "Dockerfile の最後の stage が dev でない",
      );
    }
    const tolerantDev = dockerfile.replace(
      /^FROM web-build AS dev$/m,
      "FROM web-build as dev # 既定 target",
    );
    expect(tolerantDev).not.toBe(dockerfile);
    expect(dockerfileViolations(tolerantDev, packages)).toEqual([]);
  });
});
