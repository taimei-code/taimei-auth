import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

export const readRepoText = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

export const adrFiles = (): string[] =>
  readdirSync(join(REPO_ROOT, "docs/adr"))
    .filter((name) => /^\d{4}-.+\.md$/.test(name) && !name.endsWith(".analysis.md"))
    .map((name) => `docs/adr/${name}`);
