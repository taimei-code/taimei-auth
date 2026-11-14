import { join } from "node:path";
import { argv, exit } from "node:process";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const REGISTRY_TIMEOUT_MS = 30_000;
const REGISTRY_ENTRY_TYPES = JSON.stringify(["string", "string", "object", "string"]);

type LockEntry = readonly unknown[];

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const annotate = (message: string) =>
  `::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

const git = (args: readonly string[]) => {
  const ran = Bun.spawnSync(["git", ...args], { stderr: "pipe" });
  ensure(ran.exitCode === 0, `git ${args.join(" ")} が失敗した: ${ran.stderr.toString().trim()}`);
  return ran.stdout.toString();
};

const readInstall = async (root: string) => {
  const { install } = Bun.TOML.parse(await Bun.file(join(root, "bunfig.toml")).text()) as {
    install?: Record<string, unknown>;
  };
  ensure(install, "bunfig.toml に [install] が無い");
  const {
    minimumReleaseAge,
    minimumReleaseAgeExcludes = [],
    registry = DEFAULT_REGISTRY,
  } = install;
  ensure(typeof minimumReleaseAge === "number", "bunfig.toml の minimumReleaseAge が数でない");
  ensure(Array.isArray(minimumReleaseAgeExcludes), "minimumReleaseAgeExcludes が配列でない");
  ensure(typeof registry === "string", "bunfig.toml の registry が文字列でない");
  return {
    minimumAgeMs: minimumReleaseAge * 1000,
    excludes: new Set(minimumReleaseAgeExcludes.map(String)),
    registry: registry.replace(/\/+$/, ""),
  };
};

const lockEntries = (text: string, source: string) => {
  const { packages } = Bun.JSONC.parse(text) as { packages?: Record<string, LockEntry> };
  ensure(packages, `${source} に packages が無い`);
  return Object.values(packages);
};

const idOf = (entry: LockEntry) => {
  const id = String(entry[0]);
  const at = id.lastIndexOf("@");
  return { id, name: id.slice(0, at), version: id.slice(at + 1) };
};

const registryPackageOf = (entry: LockEntry) => {
  const pkg = idOf(entry);
  const reason = `${JSON.stringify(entry)} は既定の registry の entry でないので、公開日時を調べられない。調べなくてよい package は minimumReleaseAgeExcludes に足す`;
  ensure(JSON.stringify(entry.map((value) => typeof value)) === REGISTRY_ENTRY_TYPES, reason);
  ensure(entry[1] === "", reason);
  ensure(pkg.name !== "", reason);
  return pkg;
};

const publishTimes = async (registry: string, name: string) => {
  const url = `${registry}/${name.replace("/", "%2f")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) }).catch(
    (error: unknown) => {
      throw new Error(`${url} に届かない: ${String(error)}`);
    },
  );
  ensure(response.ok, `${url} が ${response.status} を返した`);
  const { time } = (await response.json()) as { time?: Record<string, unknown> };
  ensure(time, `${url} の応答に time が無い`);
  return [name, time] as const;
};

const tooYoungVersions = async (baseRef: string | undefined) => {
  ensure(baseRef, "usage: bun scripts/check-lockfile-release-age.ts <base ref, e.g. origin/main>");
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const { minimumAgeMs, excludes, registry } = await readInstall(root);
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const baseLock = `${mergeBase}:bun.lock`;
  const baseEntries = new Set(
    lockEntries(git(["show", baseLock]), baseLock).map((entry) => JSON.stringify(entry)),
  );

  const added = new Map(
    lockEntries(await Bun.file(join(root, "bun.lock")).text(), "bun.lock")
      .filter((entry) => !baseEntries.has(JSON.stringify(entry)))
      .filter((entry) => !String(entry[0]).includes("@workspace:"))
      .filter((entry) => !excludes.has(idOf(entry).name))
      .map(registryPackageOf)
      .map((pkg) => [pkg.id, pkg]),
  );
  const timesByName = new Map(
    await Promise.all(
      [...new Set([...added.values()].map(({ name }) => name))].map((name) =>
        publishTimes(registry, name),
      ),
    ),
  );

  const now = Date.now();
  const checked = [...added.values()].map(({ id, name, version }) => {
    const publishedAt = Date.parse(String(timesByName.get(name)?.[version]));
    ensure(!Number.isNaN(publishedAt), `${id} の公開日時が registry に無い`);
    return { id, publishedAt, eligibleAt: publishedAt + minimumAgeMs };
  });
  return {
    checked: checked.length,
    tooYoung: checked.filter(({ eligibleAt }) => eligibleAt > now),
  };
};

const result = await tooYoungVersions(argv[2]).catch((error: unknown) => {
  console.log(annotate(String(error)));
  exit(1);
});

for (const { id, publishedAt, eligibleAt } of result.tooYoung) {
  console.log(
    annotate(
      `${id} は ${new Date(publishedAt).toISOString()} の公開で、${new Date(eligibleAt).toISOString()} まで bunfig.toml の minimumReleaseAge を満たさない。待てない security patch は ADR-0009 §H の運用で minimumReleaseAgeExcludes に足す`,
    ),
  );
}
if (result.tooYoung.length > 0) {
  exit(1);
}
console.log(`bun.lock に足した ${result.checked} 版は、どれも minimumReleaseAge を満たす`);
