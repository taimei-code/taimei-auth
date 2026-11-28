import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, readEnvFile } from "./config-invariant-helpers";

type VolumeMount = { type?: string; source?: string; target?: string };
type DevCompose = {
  services: {
    "auth-service": {
      command: string[];
      volumes?: (VolumeMount | string)[];
      env_file: string[];
      environment: Record<string, unknown> | string[];
      ports?: string[];
      networks?: Record<string, { aliases?: string[] } | null>;
    };
  };
  volumes?: Record<string, unknown>;
};

const MISSING_PERSIST_FLAG = "auth-service の command に --persist-to が無い";
const NO_NAMED_VOLUME_AT_PERSIST_PATH =
  "--persist-to の path に、top level で宣言した名前付き volume が long form (type: volume) で付いていない";

const devCompose = Bun.YAML.parse(
  readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8"),
) as DevCompose;

const persistenceProblems = (compose: DevCompose) => {
  const { command, volumes = [] } = compose.services["auth-service"];
  const flagIndex = command.indexOf("--persist-to");
  if (flagIndex === -1) return [MISSING_PERSIST_FLAG];
  const attached = volumes.some(
    (mount) =>
      typeof mount === "object" &&
      mount.type === "volume" &&
      mount.target === command[flagIndex + 1] &&
      Object.hasOwn(compose.volumes ?? {}, mount.source ?? ""),
  );
  return attached ? [] : [NO_NAMED_VOLUME_AT_PERSIST_PATH];
};

describe("開発環境の wrangler の手元の状態は名前付き volume に置くので、image の作り直しと down の後の up でも切り替えが残り、down -v で消える", () => {
  test("auth-service の command の --persist-to の path に、top level で宣言した名前付き volume が付いている", () => {
    expect(persistenceProblems(devCompose)).toEqual([]);
  });

  test.each([
    [
      MISSING_PERSIST_FLAG,
      (service: DevCompose["services"]["auth-service"]) => {
        service.command.splice(service.command.indexOf("--persist-to"), 2);
      },
    ],
    [
      NO_NAMED_VOLUME_AT_PERSIST_PATH,
      (service: DevCompose["services"]["auth-service"]) => {
        service.volumes = (service.volumes ?? []).map((mount) =>
          typeof mount === "object" ? { ...mount, target: "/elsewhere" } : mount,
        );
      },
    ],
  ])("壊した compose は「%s」として報告される", (problem, breakCompose) => {
    const compose = structuredClone(devCompose);
    breakCompose(compose.services["auth-service"]);
    expect(persistenceProblems(compose)).toEqual([problem]);
  });
});

const SDK_SERVICE_KEY_FILE = "packages/auth-client/testing/service-key.env";

describe("開発環境は consumer と共有する service key を SDK の file から読み、開発者の .env より優先する (.env 任せにすると、設定し忘れた時に検証が省かれる経路に入る)", () => {
  test("auth-service は service key の値を直に書かない (environment の値は env_file の値に勝つ)", () => {
    const { environment } = devCompose.services["auth-service"];
    const names = Array.isArray(environment)
      ? environment.map((entry) => entry.split("=")[0])
      : Object.keys(environment);

    expect(names).not.toContain("AUTH_SERVICE_KEY");
  });

  test("auth-service は env_file の最後に SDK の file を置く (後ろの file の値が開発者の .env の値に勝つ)", () => {
    expect(devCompose.services["auth-service"].env_file.at(-1)).toBe(SDK_SERVICE_KEY_FILE);
  });
});

const SDK_DEVELOPMENT_ENVIRONMENT_FILE = "packages/auth-client/testing/development-environment.env";

describe("開発環境は固定の値を、consumer も読む SDK の file から読み、開発者の .env より優先する (consumer は同じ file の値に合わせて開発環境につなぐ)", () => {
  test("auth-service は固定の値を直に書かない (environment の値は env_file の値に勝つので、書くと consumer が読む値と食い違う)", () => {
    const { environment } = devCompose.services["auth-service"];
    const names = Array.isArray(environment)
      ? environment.map((entry) => entry.split("=")[0])
      : Object.keys(environment);
    const fixedValueNames = Object.keys(
      readEnvFile(join(REPO_ROOT, SDK_DEVELOPMENT_ENVIRONMENT_FILE)),
    );

    expect(names.filter((name) => fixedValueNames.includes(name))).toEqual([]);
  });

  test("auth-service は SDK の固定の値の file を env_file の後ろから 2 つ目 (service key の file の前) に置く (後ろの file の値が開発者の .env の値に勝つ)", () => {
    expect(devCompose.services["auth-service"].env_file.slice(-2)).toEqual([
      SDK_DEVELOPMENT_ENVIRONMENT_FILE,
      SDK_SERVICE_KEY_FILE,
    ]);
  });

  test("auth-service の network の上の別名、PORT、公開する port は、SDK の file の auth の住所と同じ host と port である (consumer は file の住所で auth に届く)", () => {
    const { environment, networks, ports } = devCompose.services["auth-service"];
    const authUrl = new URL(
      readEnvFile(join(REPO_ROOT, SDK_DEVELOPMENT_ENVIRONMENT_FILE)).AUTH_SERVICE_URL ?? "",
    );
    const port = Array.isArray(environment)
      ? environment.find((entry) => entry.startsWith("PORT="))?.slice("PORT=".length)
      : environment.PORT;

    expect(Object.values(networks ?? {}).flatMap((network) => network?.aliases ?? [])).toContain(
      authUrl.hostname,
    );
    expect(String(port)).toBe(authUrl.port);
    expect(ports).toContain(`${authUrl.port}:${authUrl.port}`);
  });
});
