const LOCAL_DATABASE_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "auth-postgres",
  "taimei-auth-postgres",
]);

export type DatabaseTarget =
  | { readonly _tag: "Unset" }
  | { readonly _tag: "Local"; readonly hostname: string }
  | { readonly _tag: "Remote"; readonly hostname: string | null };

const hostPgConnectsTo = (url: URL): string =>
  (url.searchParams.get("host") || url.hostname).toLowerCase();

export const databaseTarget = (url: string | undefined): DatabaseTarget => {
  if (!url) return { _tag: "Unset" };
  const hostname = URL.canParse(url) ? hostPgConnectsTo(new URL(url)) : null;
  return hostname !== null && LOCAL_DATABASE_HOSTNAMES.has(hostname)
    ? { _tag: "Local", hostname }
    : { _tag: "Remote", hostname };
};

export type LocalDatabase = Extract<DatabaseTarget, { readonly _tag: "Local" }>;

export const requireLocalDatabase = (url: string | undefined): LocalDatabase => {
  const target = databaseTarget(url);
  if (target._tag === "Local") return target;
  const hostname =
    target._tag === "Remote" ? (target.hostname ?? "(URL として読めない)") : "(未設定)";
  throw new Error(
    `DB の host "${hostname}" は local の DB (${[...LOCAL_DATABASE_HOSTNAMES].join(" / ")}) ではない。本番以外の表と試験の行を書くので、local の Postgres に向ける`,
  );
};
