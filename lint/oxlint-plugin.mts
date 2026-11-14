import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

type AstNode = {
  readonly type: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly computed?: boolean;
  readonly operator?: string;
  readonly importKind?: string;
  readonly exportKind?: string;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly meta?: AstNode;
  readonly callee?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly params?: readonly AstNode[];
  readonly left?: AstNode;
  readonly right?: AstNode;
  readonly key?: AstNode;
  readonly imported?: AstNode;
  readonly local?: AstNode;
  readonly source?: AstNode | null;
  readonly specifiers?: readonly AstNode[];
  readonly elements?: readonly (AstNode | null)[];
  readonly properties?: readonly AstNode[];
  readonly quasis?: readonly AstNode[];
  readonly typeAnnotation?: AstNode;
  readonly expression?: AstNode;
  readonly typeName?: AstNode;
  readonly discriminant?: AstNode;
  readonly declaration?: AstNode | null;
  readonly id?: AstNode;
  readonly body?: readonly AstNode[];
  readonly parent?: AstNode;
};

type Comment = { readonly type: "Line" | "Block" | "Shebang"; readonly value: string };

type Scope = {
  readonly set: ReadonlyMap<string, unknown>;
  readonly upper: Scope | null;
};

type RuleContext = {
  readonly filename: string;
  readonly report: (descriptor: { readonly node: unknown; readonly message: string }) => void;
  readonly sourceCode: {
    readonly getAllComments: () => readonly Comment[];
    readonly getText: (node: AstNode) => string;
    readonly getAncestors: (node: AstNode) => readonly AstNode[];
    readonly getScope: (node: AstNode) => Scope;
  };
};

type Visitors = Readonly<Record<string, (node: AstNode) => void>>;

type Report = (node: unknown, matchedText?: string) => void;

type Matcher =
  | { readonly kind: "identifier"; readonly names: readonly string[]; readonly callOnly?: true }
  | { readonly kind: "member"; readonly paths: readonly string[]; readonly callOnly?: true }
  | { readonly kind: "valueImport"; readonly source: RegExp }
  | { readonly kind: "importTarget"; readonly target: RegExp; readonly includesTypeImports?: true }
  | { readonly kind: "typeAssertion"; readonly typePrefix: string }
  | { readonly kind: "literal"; readonly pattern: RegExp }
  | {
      readonly kind: "custom";
      readonly visitors: (report: Report, path: string, context: RuleContext) => Visitors;
    };

type Row = {
  readonly name: string;
  readonly within: readonly string[];
  readonly allowedIn?: readonly string[];
  readonly allowedMatches?: Readonly<Record<string, readonly string[]>>;
  readonly includesTestFiles?: true;
  readonly matchers: readonly Matcher[];
  readonly message: string;
};

export const SOURCE_ROOTS = [
  "src",
  "db",
  "web/src",
  "e2e",
  "management",
  "packages",
  "testing",
] as const;

const PRODUCTION_ROOTS = SOURCE_ROOTS.map((root) => `${root}/**`);

const configRootCache = new Map<string, string>();

const configRootOf = (dir: string): string => {
  const cached = configRootCache.get(dir);
  if (cached !== undefined) {
    return cached;
  }
  const parent = dirname(dir);
  const root =
    existsSync(join(dir, ".oxlintrc.json")) || parent === dir ? dir : configRootOf(parent);
  configRootCache.set(dir, root);
  return root;
};

const pathFromConfigRoot = (filename: string) =>
  relative(configRootOf(dirname(filename)), filename)
    .split("\\")
    .join("/");

const GLOB_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[.+^$()|[\]\\]/g, "\\$&"],
  [/\*\*\//g, "\uE000"],
  [/\*\*/g, "\uE001"],
  [/\*/g, "[^/]*"],
  [/\uE000/g, "(?:.*/)?"],
  [/\uE001/g, ".*"],
];

const globPatterns = new Map<string, RegExp>();

const globPattern = (glob: string): RegExp => {
  const cached = globPatterns.get(glob);
  if (cached !== undefined) {
    return cached;
  }
  const pattern = new RegExp(
    `^${GLOB_TOKENS.reduce((pattern, [token, replacement]) => pattern.replace(token, replacement), glob)}$`,
  );
  globPatterns.set(glob, pattern);
  return pattern;
};

const matchesAny = (path: string, globs: readonly string[]) =>
  globs.some((glob) => globPattern(glob).test(path));

const isTestPath = (path: string) => `/${path}`.includes("/__tests__/");

const appliesTo = (row: Row, path: string) =>
  matchesAny(path, row.within) &&
  !matchesAny(path, row.allowedIn ?? []) &&
  (row.includesTestFiles === true || !isTestPath(path));

const UNKNOWN_OBJECT = "";

const PATH_OF: Readonly<Record<string, (node: AstNode) => string>> = {
  Identifier: (node) => node.name ?? UNKNOWN_OBJECT,
  MetaProperty: (node) => `${node.meta?.name}.${node.property?.name}`,
  MemberExpression: (node) =>
    node.computed === true ? UNKNOWN_OBJECT : `${memberPathOf(node.object)}.${node.property?.name}`,
};

const memberPathOf = (node: AstNode | undefined): string =>
  node === undefined ? UNKNOWN_OBJECT : (PATH_OF[node.type]?.(node) ?? UNKNOWN_OBJECT);

const withoutAssertion = (node: AstNode | undefined): AstNode | undefined =>
  node?.type === "TSNonNullExpression" || node?.type === "TSAsExpression"
    ? withoutAssertion(node.expression)
    : node;

const endsWithPath = (fullPath: string, path: string) =>
  path.startsWith(".")
    ? fullPath.endsWith(path)
    : fullPath === path || fullPath.endsWith(`.${path}`);

const isCallee = (node: AstNode) =>
  node.parent?.type === "CallExpression" && node.parent.callee === node;

const calleeNameOf = (callee: AstNode | undefined): string | undefined =>
  callee?.type === "MemberExpression" && callee.computed !== true
    ? callee.property?.name
    : callee?.type === "Identifier"
      ? callee.name
      : undefined;

const stringOf = (node: AstNode | null | undefined): string | undefined => {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral") {
    return (node.quasis ?? [])
      .map((quasi) => (quasi.value as { cooked?: string } | undefined)?.cooked ?? "")
      .join("");
  }
  return undefined;
};

const valueSpecifiersNamed = (node: AstNode, name: string): readonly AstNode[] =>
  isTypeOnlyImport(node)
    ? []
    : (node.specifiers ?? []).filter(
        (each) => each.imported?.name === name && each.importKind !== "type",
      );

const isTypeOnlyImport = (node: AstNode) =>
  node.importKind === "type" ||
  node.exportKind === "type" ||
  ((node.specifiers ?? []).length > 0 &&
    (node.specifiers ?? []).every(
      (specifier) => specifier.importKind === "type" || specifier.exportKind === "type",
    ));

export const TSCONFIG_PATH_ALIASES = [
  { prefix: "@core/", directory: "src" },
  { prefix: "@/", directory: "" },
] as const;

const importTargetOf = (filename: string, specifier: string): string => {
  const alias = TSCONFIG_PATH_ALIASES.find(({ prefix }) => specifier.startsWith(prefix));
  if (alias !== undefined) {
    return posix.join(alias.directory, specifier.slice(alias.prefix.length));
  }
  return specifier.startsWith(".")
    ? pathFromConfigRoot(resolve(dirname(filename), specifier))
    : specifier;
};

type CheckedImports = "valueOnly" | "valueAndType";

const importVisitors = (
  matchedTextOf: (source: string) => string | undefined,
  checkedImports: CheckedImports,
  report: Report,
): Visitors => {
  const check = (node: AstNode) => {
    const source = stringOf(node.source);
    const matchedText = source === undefined ? undefined : matchedTextOf(source);
    if (matchedText !== undefined) {
      report(node, matchedText);
    }
  };
  const checkDeclaration = (node: AstNode) => {
    if (checkedImports === "valueAndType" || !isTypeOnlyImport(node)) {
      check(node);
    }
  };
  return {
    ImportDeclaration: checkDeclaration,
    ExportNamedDeclaration: checkDeclaration,
    ExportAllDeclaration: checkDeclaration,
    ImportExpression: check,
  };
};

const importTargetVisitors = (
  matcher: Extract<Matcher, { kind: "importTarget" }>,
  filename: string,
  report: Report,
): Visitors =>
  importVisitors(
    (source) => {
      const target = importTargetOf(filename, source);
      return matcher.target.test(target) ? target : undefined;
    },
    matcher.includesTypeImports === true ? "valueAndType" : "valueOnly",
    report,
  );

const visitorsOf = (
  matcher: Matcher,
  report: Report,
  path: string,
  context: RuleContext,
): Visitors => {
  switch (matcher.kind) {
    case "identifier": {
      const reportNamedCallee = (node: AstNode) => {
        if (matcher.names.includes(calleeNameOf(node.callee) ?? "")) {
          report(node);
        }
      };
      return matcher.callOnly === true
        ? { CallExpression: reportNamedCallee, NewExpression: reportNamedCallee }
        : {
            Identifier: (node) => {
              if (matcher.names.includes(node.name ?? "")) {
                report(node);
              }
            },
          };
    }
    case "member":
      return {
        MemberExpression: (node) => {
          const fullPath = memberPathOf(node);
          if (
            matcher.paths.some((each) => endsWithPath(fullPath, each)) &&
            (matcher.callOnly !== true || isCallee(node))
          ) {
            report(node);
          }
        },
      };
    case "valueImport":
      return importVisitors(
        (source) => (matcher.source.test(source) ? source : undefined),
        "valueOnly",
        report,
      );
    case "importTarget":
      return importTargetVisitors(matcher, context.filename, report);
    case "literal": {
      const check = (node: AstNode) => {
        const text = stringOf(node);
        if (text !== undefined && matcher.pattern.test(text)) {
          report(node);
        }
      };
      return { Literal: check, TemplateLiteral: check };
    }
    case "typeAssertion":
      return {
        TSAsExpression: (node) => {
          if (typeReferenceNameOf(node).startsWith(matcher.typePrefix)) {
            report(node);
          }
        },
      };
    case "custom":
      return matcher.visitors(report, path, context);
  }
};

const mergeVisitors = (all: readonly Visitors[]): Visitors =>
  Object.fromEntries(
    [...new Set(all.flatMap((visitors) => Object.keys(visitors)))].map((selector) => [
      selector,
      (node: AstNode) => {
        for (const visitors of all) {
          visitors[selector]?.(node);
        }
      },
    ]),
  );

const ruleOf = (row: Row) => ({
  create: (context: RuleContext): Visitors => {
    const path = pathFromConfigRoot(context.filename);
    if (!appliesTo(row, path)) {
      return {};
    }
    const allowedMatches = row.allowedMatches?.[path] ?? [];
    const report: Report = (node, matchedText) => {
      if (matchedText === undefined || !allowedMatches.includes(matchedText)) {
        context.report({ node, message: row.message });
      }
    };
    return mergeVisitors(row.matchers.map((matcher) => visitorsOf(matcher, report, path, context)));
  },
});

const isArrowIgnoringArgument = (node: AstNode | undefined) =>
  node?.type === "ArrowFunctionExpression" &&
  ((node.params ?? []).length === 0 ||
    ((node.params ?? []).length === 1 && (node.params?.[0]?.name ?? "").startsWith("_")));

const typeReferenceNameOf = (node: AstNode) =>
  node.typeAnnotation?.type === "TSTypeReference" ? (node.typeAnnotation.typeName?.name ?? "") : "";

const LINE_DIRECTIVES = [
  /^\/\s*<reference/,
  /^\s*@ts-expect-error/,
  /^\s*oxlint-disable-next-line\s/,
];

const BLOCK_DIRECTIVES = [/^\s*oxlint-disable-next-line\s/, /^\s*@vite-ignore/];

const isDirective = (comment: Comment) =>
  comment.type === "Shebang" ||
  (comment.type === "Line" ? LINE_DIRECTIVES : BLOCK_DIRECTIVES).some((directive) =>
    directive.test(comment.value),
  );

const TEST_FUNCTIONS = new Set(["describe", "it", "test"]);

const isTestFunction = (callee: AstNode | undefined): boolean => {
  if (callee?.type === "Identifier") {
    return TEST_FUNCTIONS.has(callee.name ?? "");
  }
  if (callee?.type === "MemberExpression") {
    return isTestFunction(callee.object);
  }
  return callee?.type === "CallExpression" && isTestFunction(callee.callee);
};

const DESIGN_NUMBER =
  /\b(?:AC|QA-(?!MR-)[A-Z]{1,2})-\d+|(?<![A-Za-z0-9])[A-Z]-\d+\b|^[A-Z]{1,2}\d+[a-z]?:|^T\d |\bStage \d|(?<![\w&])#\d+\b/;

const CLIENT_NAVIGATIONS = new Set(["PushUrl", "pushUrl", "replaceUrl"]);

const ownRouteNamesOf = (program: AstNode): ReadonlySet<string> =>
  new Set(
    (program.body ?? [])
      .filter(
        (statement) =>
          statement.type === "ImportDeclaration" && stringOf(statement.source) === "./route",
      )
      .flatMap((statement) => (statement.specifiers ?? []).map((each) => each.local?.name ?? "")),
  );

const hrefOf = (call: AstNode): AstNode | undefined => {
  const [first] = call.arguments ?? [];
  if (first?.type !== "ObjectExpression") {
    return first;
  }
  return (first.properties ?? []).find((property) => property.key?.name === "href")?.value as
    | AstNode
    | undefined;
};

const isOwnRouteCall = (node: AstNode | undefined, ownRoutes: ReadonlySet<string>) =>
  node?.type === "CallExpression" &&
  node.callee?.type === "Identifier" &&
  ownRoutes.has(node.callee.name ?? "");

const isTagMember = (node: AstNode | undefined) =>
  node?.type === "MemberExpression" && node.computed !== true && node.property?.name === "_tag";

const isImportFrom = (statement: AstNode, source: RegExp) =>
  statement.type === "ImportDeclaration" && source.test(stringOf(statement.source) ?? "");

const importsFoldkit = (program: AstNode) =>
  (program.body ?? []).some((statement) => isImportFrom(statement, /^(foldkit|@foldkit\/)/));

const isSpaHttpClientValueImport = (statement: AstNode) =>
  isImportFrom(statement, /(^|\/)spa-http-client$/) && !isTypeOnlyImport(statement);

const isOnlyArgumentOf = (node: AstNode, calleeName: string) => {
  const call = node.parent;
  return (
    call?.type === "CallExpression" &&
    calleeNameOf(call.callee) === calleeName &&
    call.arguments?.length === 1 &&
    call.arguments[0] === node
  );
};

const isAppEnvPassedToOutsideProductionCheck = (read: AstNode | undefined) =>
  read !== undefined &&
  memberPathOf(read) === "process.env.APP_ENV" &&
  isOnlyArgumentOf(read, "isOutsideProduction");

const NEVER_FAILING_LAYERS = new Set(["succeed", "mergeAll", "provide"]);

const COMPARISONS = new Set(["===", "!==", "==", "!="]);

const DB_ACCESS_TARGET = /^drizzle-orm(\/|$)|^db\/(client|schema)(\/|\.|$)/;

const PG_TARGET = /^pg(\/|$)/;

const peerDependenciesByRoot = new Map<string, readonly string[]>();

const sdkPeerDependencies = (filename: string): readonly string[] => {
  const root = configRootOf(dirname(filename));
  const cached = peerDependenciesByRoot.get(root);
  if (cached !== undefined) {
    return cached;
  }
  const manifest: { readonly peerDependencies?: Readonly<Record<string, string>> } = JSON.parse(
    readFileSync(join(root, "packages/auth-client/package.json"), "utf8"),
  );
  const names = Object.keys(manifest.peerDependencies ?? {});
  peerDependenciesByRoot.set(root, names);
  return names;
};

export const packageNameOf = (specifier: string): string =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

const ROWS: readonly Row[] = [
  {
    name: "no-fetch-in-web",
    within: ["web/src/**"],
    matchers: [{ kind: "identifier", names: ["fetch"], callOnly: true }],
    message:
      "web は fetch を書かない。SPA の API は shared/spa-http-client.ts の SpaHttpClient で呼ぶ",
  },
  {
    name: "spa-http-client-only-in-foldkit-files",
    within: ["web/src/**"],
    allowedIn: ["web/src/app/*/entry.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          Program: (program) => {
            if (!importsFoldkit(program)) {
              (program.body ?? [])
                .filter(isSpaHttpClientValueImport)
                .forEach((node) => report(node));
            }
          },
        }),
      },
    ],
    message:
      "SpaHttpClient を使うのは Foldkit の file (Command の中) と application の起動 (app/*/entry.ts) だけ",
  },
  {
    name: "no-effect-http-value-import-in-web",
    within: ["web/src/**"],
    matchers: [{ kind: "valueImport", source: /^effect\/http$/ }],
    message: "web は effect/http を値で import しない。通信は SpaHttpClient の Command で書く",
  },
  {
    name: "auth-client-list-only-in-auth-client-read",
    within: ["web/src/**"],
    allowedIn: ["web/src/account/auth-client-read.ts"],
    matchers: [{ kind: "member", paths: [".listSessions", ".listAccounts"] }],
    message:
      "better-auth の一覧の読み出しは account/auth-client-read.ts だけが書く (失敗の応答を失敗にする読み手を 1 つにする)",
  },
  {
    name: "leave-spa-only-in-leave-spa",
    within: ["web/src/**"],
    allowedIn: ["web/src/shared/leave-spa.ts"],
    matchers: [
      { kind: "member", paths: ["location.replace", "location.assign", "Navigation.load"] },
      {
        kind: "custom",
        visitors: (report) => ({
          AssignmentExpression: (node) => {
            if (node.operator === "=" && endsWithPath(memberPathOf(node.left), "location.href")) {
              report(node);
            }
          },
          ImportDeclaration: (node) => {
            if (stringOf(node.source) === "foldkit/navigation") {
              valueSpecifiersNamed(node, "load").forEach((node) => report(node));
            }
          },
        }),
      },
    ],
    message:
      "SPA を離れる遷移 (window.location・foldkit の load) は shared/leave-spa.ts だけが書く",
  },
  {
    name: "no-ignored-cause-in-web",
    within: ["web/src/**"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          Property: (node) => {
            if (node.key?.name === "onFailure" && isArrowIgnoringArgument(node.value as AstNode)) {
              report(node);
            }
          },
          CallExpression: (node) => {
            if (
              memberPathOf(node.callee) === "Effect.catch" &&
              isArrowIgnoringArgument(node.arguments?.[0])
            ) {
              report(node);
            }
          },
        }),
      },
    ],
    message: "失敗の cause を捨てない。失敗は Message の失敗に写し、画面が文言を選ぶ",
  },
  {
    name: "no-or-else-succeed",
    within: ["src/**", "web/src/**"],
    matchers: [{ kind: "identifier", names: ["orElseSucceed"] }],
    message:
      "失敗を黙って成功の値に倒さない (orElseSucceed を使わない)。失敗は値で返すか、記録して型に残す",
  },
  {
    name: "sign-out-only-in-sign-out",
    within: ["web/src/**"],
    allowedIn: ["web/src/auth/sign-out.ts"],
    matchers: [{ kind: "member", paths: [".signOut"], callOnly: true }],
    message: "sign-out で better-auth を呼ぶのは auth/sign-out.ts の signOut だけ",
  },
  {
    name: "cause-lookup-only-in-failure-message",
    within: ["web/src/**"],
    allowedIn: ["web/src/shared/failure-message.ts"],
    matchers: [{ kind: "member", paths: ["Cause.findErrorOption"] }],
    message: "Cause.findErrorOption で失敗を取り出すのは shared/failure-message.ts だけ",
  },
  {
    name: "no-tag-comparison-in-web",
    within: ["web/src/**"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          BinaryExpression: (node) => {
            if (
              COMPARISONS.has(node.operator ?? "") &&
              (isTagMember(node.left) || isTagMember(node.right))
            ) {
              report(node);
            }
          },
          SwitchStatement: (node) => {
            if (isTagMember(node.discriminant)) {
              report(node);
            }
          },
          MemberExpression: (node) => {
            if (memberPathOf(node) === "Predicate.isTagged") {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "web は _tag を直接比べない。union の guards・match、Schema.is、Command の Effect.catchTags で分ける",
  },
  {
    name: "client-navigation-uses-own-routes",
    within: ["web/src/**"],
    allowedIn: ["web/src/app/document-navigation.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => {
          let ownRoutes: ReadonlySet<string> = new Set();
          return {
            Program: (node) => {
              ownRoutes = ownRouteNamesOf(node);
            },
            CallExpression: (node) => {
              if (
                CLIENT_NAVIGATIONS.has(calleeNameOf(node.callee) ?? "") &&
                !isOwnRouteCall(hrefOf(node), ownRoutes)
              ) {
                report(node);
              }
            },
          };
        },
      },
    ],
    message:
      "client 側の遷移 (PushUrl・pushUrl・replaceUrl) には、同じ application の ./route の router が作る path だけを渡す。他方の application へは ReplaceDocument か LoadDocument で document を読み直す (ADR-0002、ADR-0023)",
  },
  {
    name: "no-inner-html-in-web",
    within: ["web/src/**", "web/non-production/**"],
    includesTestFiles: true,
    matchers: [
      { kind: "member", paths: [".InnerHTML"] },
      {
        kind: "custom",
        visitors: (report) => ({
          Property: (node) => {
            if (node.parent?.type === "ObjectPattern" && node.key?.name === "InnerHTML") {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "web の画面は生の HTML を挿入しない (h.InnerHTML を使わない)。文字列は text の子として描く",
  },
  {
    name: "app-env-only-in-sentry-options",
    within: ["src/**"],
    allowedIn: ["src/sentry-options.ts"],
    matchers: [{ kind: "identifier", names: ["APP_ENV"] }],
    message:
      "本番の code は自分が本番かどうかを知らない。src で APP_ENV を読むのは Sentry の環境名を決める src/sentry-options.ts だけ (ADR-0021)",
  },
  {
    name: "no-build-mode-in-web",
    within: ["web/src/**"],
    matchers: [
      {
        kind: "member",
        paths: ["import.meta.env.MODE", "import.meta.env.PROD", "import.meta.env.DEV"],
      },
    ],
    message:
      "本番の code は自分が本番かどうかを知らない。web/src は vite の build の mode を読まない (ADR-0021)",
  },
  {
    name: "run-in-transaction-only-in-transaction",
    within: ["src/**"],
    allowedIn: ["src/transaction.ts"],
    matchers: [{ kind: "identifier", names: ["runInTransaction"] }],
    message:
      "transaction は Transaction.run で取る。runInTransaction を直接使うのは src/transaction.ts だけ (ADR-0012)",
  },
  {
    name: "spa-api-path-only-in-contract",
    within: ["src/**"],
    allowedIn: ["src/**/*-contract.ts"],
    matchers: [{ kind: "literal", pattern: /^\/api\/(?!auth(\/|$))/ }],
    message:
      "SPA の API (/api/auth 以外の /api/*) は Hono に直接登録せず、契約 (*-contract.ts) を handlers/*-http-api.ts で実装して mountSpaApi で載せる",
  },
  {
    name: "no-raw-http-response-in-handlers",
    within: ["src/handlers/**"],
    matchers: [
      {
        kind: "member",
        paths: [
          "HttpServerResponse.json",
          "HttpServerResponse.text",
          "HttpServerResponse.empty",
          "HttpServerResponse.raw",
          "HttpServerResponse.unsafeJson",
          "HttpServerResponse.html",
          "HttpServerResponse.stream",
        ],
      },
    ],
    message:
      "HttpApi の handler は HttpServerResponse を直接組まない (契約の応答の型を素通りしない)",
  },
  {
    name: "port-import-only-in-reading-transport",
    within: ["src/handlers/**", "src/rpc/**"],
    allowedIn: [
      "src/handlers/spa-http-api.ts",
      "src/handlers/auth-entry-redirect.ts",
      "src/rpc/auth-handler.ts",
      "src/rpc/company-handler.ts",
      "src/rpc/user-handler.ts",
    ],
    matchers: [{ kind: "valueImport", source: /\/ports$/ }],
    message:
      "Transport は repository の port を値で import せず、guard の値を use-case か読み出しの関数に渡す (repository へ直接 write しない)。許した file は port を読み出しにだけ使う",
  },
  {
    name: "no-policy-or-transaction-in-transport",
    within: ["src/handlers/**", "src/rpc/**"],
    matchers: [{ kind: "valueImport", source: /(^|\/)(policy|transaction)$/ }],
    message:
      "Transport (handlers/・rpc/) は policy 述語と transaction を持たない。認可は Guard、transaction は Use-case が受け持つ (ADR-0012)",
  },
  {
    name: "no-effect-in-db",
    within: ["db/**"],
    includesTestFiles: true,
    matchers: [{ kind: "literal", pattern: /^effect(\/.*)?$/ }],
    message:
      "db/ は effect を import しない (Repository の境界。Effect の面は src の ports が持つ。ADR-0017)",
  },
  {
    name: "repository-import-only-in-wiring",
    within: ["src/**"],
    allowedIn: ["src/**/wiring.ts", "src/id-generator.ts", "src/transaction.ts", "src/auth.ts"],
    matchers: [{ kind: "importTarget", target: /^db\/(repositories|transaction)(\/|\.|$)/ }],
    message:
      "Use-case は Repository を ports 経由で使う。db/repositories と db/transaction を値で import するのは wiring.ts・id-generator.ts・transaction.ts・auth.ts だけ",
  },
  {
    name: "no-promise-all",
    within: ["src/**"],
    matchers: [{ kind: "member", paths: ["Promise.all"], callOnly: true }],
    message: "Promise.all を直接呼ばない (Effect.all にそろえる)",
  },
  {
    name: "run-background-only-in-background",
    within: ["src/**"],
    allowedIn: ["src/background.ts"],
    matchers: [
      { kind: "identifier", names: ["runBackground"], callOnly: true },
      { kind: "member", paths: ["Effect.forkDetach"] },
    ],
    message:
      "fire-and-forget は Background.run で書く。runBackground を呼び、fiber を切り離す (Effect.forkDetach) のは src/background.ts だけ",
  },
  {
    name: "sentry-capture-only-in-sentry-facade",
    within: ["src/**"],
    allowedIn: ["src/sentry.ts", "src/handlers/client-facing-error.ts"],
    matchers: [
      {
        kind: "member",
        paths: ["Sentry.captureException", "Sentry.captureMessage"],
        callOnly: true,
      },
    ],
    message:
      "Sentry の facade を直接呼ぶのは src/sentry.ts と settleCause (client-facing-error.ts) だけ。ほかは SentryService を使う",
  },
  {
    name: "audit-append-only-in-append",
    within: ["src/**"],
    allowedIn: ["src/audit/append.ts"],
    matchers: [{ kind: "member", paths: [".appendAuditLog", ".appendAuditLogs"], callOnly: true }],
    message: "audit log を書き込むのは src/audit/append.ts の 2 つの入口だけ",
  },
  {
    name: "no-effect-ignore",
    within: ["src/**"],
    matchers: [{ kind: "member", paths: ["Effect.ignore"] }],
    message:
      "失敗を黙って捨てない (Effect.ignore を使わない)。値に倒すなら captureCauseAs で記録する",
  },
  {
    name: "log-error-only-in-email-client",
    within: ["src/**"],
    allowedIn: ["src/email/client.ts"],
    matchers: [{ kind: "member", paths: ["Effect.logError"] }],
    message: "logError だけで失敗を握らない。Effect.logError を使うのは src/email/client.ts だけ",
  },
  {
    name: "capture-cause-only-in-listed-files",
    within: ["src/**"],
    allowedIn: [
      "src/account/delete-sessions.ts",
      "src/audit/append.ts",
      "src/auth-plugins/mfa-challenge.ts",
      "src/auth-plugins/sign-in-observer.ts",
      "src/invitation/create.ts",
      "src/membership/guard/core.ts",
      "src/mfa/disable-attempt-budget.ts",
      "src/mfa/notification-adapter.ts",
      "src/mfa/totp/login-challenge.ts",
      "src/rpc/auth-handler.ts",
      "src/sentry.ts",
    ],
    matchers: [{ kind: "identifier", names: ["captureCause"], callOnly: true }],
    message:
      "captureCause を直接呼ぶのは fail-closed か void の経路の決まった file だけ。値に倒す経路は captureCauseAs を使う",
  },
  {
    name: "increment-rate-window-only-in-attempt-budget",
    within: ["src/**"],
    allowedIn: ["src/attempt-budget.ts", "src/ttl-store-service.ts", "src/ttl-store.ts"],
    matchers: [{ kind: "identifier", names: ["incrementRateWindow"] }],
    message:
      "試行枠の計数 (incrementRateWindow) を呼ぶのは attempt-budget だけ (fail-open / fail-closed の宣言を迂回させない)",
  },
  {
    name: "membership-write-only-in-apply-change",
    within: ["src/**"],
    allowedIn: ["src/membership/apply-change.ts"],
    matchers: [
      {
        kind: "member",
        paths: [
          ".insertMembership",
          ".updateMembershipRole",
          ".deleteMembership",
          ".removeMembershipsOfCompany",
        ],
        callOnly: true,
      },
    ],
    message: "membership 行の増減と role の変更は src/membership/apply-change.ts だけが呼ぶ",
  },
  {
    name: "last-used-company-write-only-in-current-company",
    within: ["src/**"],
    allowedIn: ["src/membership/current-company.ts"],
    matchers: [
      {
        kind: "member",
        paths: [".updateUserLastUsedCompany", ".reassignLastUsedCompanyAfterLeaving"],
        callOnly: true,
      },
    ],
    message: "現在の事業所の書き込みは src/membership/current-company.ts だけが呼ぶ",
  },
  {
    name: "settle-cause-only-in-adapters",
    within: ["src/**"],
    allowedIn: [
      "src/handlers/client-facing-error.ts",
      "src/handlers/run-route.ts",
      "src/handlers/spa-http-api.ts",
      "src/rpc/run-rpc.ts",
      "src/auth.ts",
      "src/app.ts",
    ],
    matchers: [{ kind: "identifier", names: ["settleCause", "captureThrown"], callOnly: true }],
    message:
      "failure と defect を client-facing の応答に変えるのは adapter (run-route・run-rpc・SPA の API) と better-auth の結線 (auth.ts・app.ts) だけ",
  },
  {
    name: "auth-api-layer-only-in-run-route",
    within: ["src/**"],
    allowedIn: ["src/handlers/run-route.ts"],
    matchers: [
      { kind: "identifier", names: ["authApiLayer"] },
      { kind: "literal", pattern: /^authApiLayer$/ },
    ],
    message:
      "route の AuthApi を差し替える authApiLayer は test だけが設定する (本番の code は run-route.ts が読むだけ)",
  },
  {
    name: "auth-module-import-only-in-entry-files",
    within: ["src/**"],
    allowedIn: ["src/app.ts", "src/auth-wiring.ts", "src/boot.ts"],
    matchers: [{ kind: "valueImport", source: /^(@\/src\/|(\.\.?\/)+)auth$/ }],
    message:
      "auth module を値で import するのは app.ts・auth-wiring.ts と、initAuth を呼ぶ boot.ts だけ。Effect からの入口は AuthApi",
  },
  {
    name: "auth-instance-import-only-in-app-and-auth-wiring",
    within: ["src/**"],
    allowedIn: ["src/app.ts", "src/auth-wiring.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          ImportDeclaration: (node) => {
            if (/^(\.\.?\/)+auth$/.test(stringOf(node.source) ?? "")) {
              valueSpecifiersNamed(node, "auth").forEach((node) => report(node));
            }
          },
        }),
      },
    ],
    message:
      "better-auth の auth instance を値で import するのは app.ts と auth-wiring.ts だけ (Effect からの入口は AuthApi)",
  },
  {
    name: "init-runtime-only-in-boot",
    within: ["src/**", "management/**"],
    allowedIn: ["src/auth.ts", "src/boot.ts", "src/runtime.ts"],
    matchers: [{ kind: "identifier", names: ["initRuntime", "initAuth"], callOnly: true }],
    message:
      "initRuntime と initAuth を呼ぶのは boot.ts だけ (runtime と better-auth に同じ TTL store を渡す)",
  },
  {
    name: "issue-session-only-in-second-factor",
    within: ["src/**"],
    allowedIn: [
      "src/auth-service.ts",
      "src/auth-wiring.ts",
      "src/mfa/totp/complete-login-challenge.ts",
    ],
    matchers: [
      { kind: "identifier", names: ["issueSession"] },
      { kind: "literal", pattern: /^issueSession$/ },
    ],
    message:
      "資格情報を確かめずに session を発行する AuthApi.issueSession を呼ぶのは、第二要素の検証を終えた complete-login-challenge.ts だけ",
  },
  {
    name: "get-session-only-in-session-check",
    within: ["src/**"],
    allowedIn: ["src/auth-wiring.ts", "src/session-check.ts"],
    matchers: [{ kind: "member", paths: [".getSession"] }],
    message:
      "有効な session の判定 (AuthApi.getSession) を呼ぶのは session-check.ts だけ (入口・SPA の guard・RPC が同じ判定を使う)",
  },
  {
    name: "api-error-shape-only-in-auth-wiring",
    within: ["src/**"],
    allowedIn: ["src/auth-wiring.ts"],
    matchers: [
      { kind: "member", paths: ["cause.body", "body.code"] },
      { kind: "identifier", names: ["UNAUTHORIZED"] },
      { kind: "literal", pattern: /UNAUTHORIZED/ },
    ],
    message:
      "better-auth の APIError の形 (body.code・UNAUTHORIZED) を読むのは auth-wiring.ts だけ",
  },
  {
    name: "db-import-in-src-tests-only-in-test-db",
    within: ["src/**/__tests__/**"],
    allowedIn: ["src/__tests__/test-db.ts"],
    includesTestFiles: true,
    matchers: [{ kind: "importTarget", target: /^db\// }],
    message:
      "src の test の DB 接触は TestDb の面 (src/__tests__/test-db.ts) に閉じる。db/ を値で import しない (型の import は可)",
  },
  {
    name: "db-import-in-e2e-only-db-testing",
    within: ["e2e/**"],
    matchers: [{ kind: "importTarget", target: /^db\/(?!testing\/)/ }],
    message:
      "e2e が値で import する db/ は db/testing/* だけ (seed・観測・cleanup の実体は db/ が持つ。spec の process に pg の Pool を開くと閉じる手段が無く、runner が止まらない)",
  },
  {
    name: "scripts-import-only-node-builtins",
    within: ["scripts/**"],
    matchers: [
      { kind: "importTarget", target: /^(?!node:)/, includesTypeImports: true },
      { kind: "identifier", names: ["createRequire"] },
      { kind: "member", paths: ["import.meta.require"] },
    ],
    message:
      "scripts/ の検査は依存を install する前に走り、検査の対象の package に結果を書き換えさせないため、node: の組み込みの module だけを import する (ADR-0009 §H)",
  },
  {
    name: "no-failing-layer-constructor-in-src",
    within: ["src/**"],
    allowedMatches: {
      "src/handlers/spa-http-api.ts": [
        "effect(Authenticated)",
        "effectContext(getRuntime().contextEffect)",
      ],
      "src/handlers/attempt-budget-http-api.ts": [
        "effect(ChallengeVerifyBudget)",
        "effect(ChallengeStateBudget)",
        "effect(MfaChangeBudget)",
      ],
    },
    matchers: [
      {
        kind: "custom",
        visitors: (report, _path, context) => ({
          CallExpression: (node) => {
            const [, constructor] =
              /^Layer\.([a-z][A-Za-z]*)$/.exec(memberPathOf(node.callee)) ?? [];
            if (constructor !== undefined && !NEVER_FAILING_LAYERS.has(constructor)) {
              const [service] = node.arguments ?? [];
              report(
                node,
                `${constructor}(${service === undefined ? "" : context.sourceCode.getText(service)})`,
              );
            }
          },
        }),
      },
    ],
    message:
      "appLayer は構築で失敗しない Layer (Layer.succeed・Layer.mergeAll・Layer.provide) だけで組む。ManagedRuntime は初回の run で Layer を構築するので、失敗し得る Layer は本番の初回の request で落ちる (ADR-0017)",
  },
  {
    name: "no-code-comment",
    within: ["src/**", "db/**", "web/**", "e2e/**", "management/**", "infra/**", "testing/**"],
    allowedIn: ["**/*.d.ts", "**/gen/**", "**/*.gen.ts"],
    includesTestFiles: true,
    matchers: [
      {
        kind: "custom",
        visitors: (report, _path, context) => ({
          Program: () => {
            context.sourceCode
              .getAllComments()
              .filter((comment) => !isDirective(comment))
              .forEach((node) => report(node));
          },
        }),
      },
    ],
    message:
      "TS にコメントを書かない。理由は名前・型・test 名へ移す。書けるのは directive (@ts-expect-error・oxlint-disable-next-line・/// <reference・@vite-ignore) だけ",
  },
  {
    name: "no-design-number-in-test-name",
    within: SOURCE_ROOTS.flatMap((root) =>
      ["*.test.ts", "*.test.tsx", "*.e2e.ts"].map((name) => `${root}/**/${name}`),
    ),
    includesTestFiles: true,
    matchers: [
      {
        kind: "custom",
        visitors: (report) => {
          const numberedRows: AstNode[] = [];
          let runsEach = false;
          return {
            CallExpression: (node) => {
              if (!isTestFunction(node.callee)) {
                return;
              }
              runsEach ||= calleeNameOf(node.callee) === "each";
              const name = stringOf(node.arguments?.[0]);
              if (name !== undefined && DESIGN_NUMBER.test(name)) {
                report(node);
              }
            },
            ArrayExpression: (node) => {
              const label = stringOf(node.elements?.[0]);
              if (
                node.parent?.type === "ArrayExpression" &&
                label !== undefined &&
                DESIGN_NUMBER.test(label)
              ) {
                numberedRows.push(node);
              }
            },
            "Program:exit": () => {
              if (runsEach) {
                numberedRows.forEach((node) => report(node));
              }
            },
          };
        },
      },
    ],
    message:
      "test 名は振る舞いの文で書き、repo の外にしか定義の無い番号 (AC-001・#52 など) を書かない。番号から意味を引けないためである。書いてよいのは repo に定義のある QA-MR-* (docs/qa/manual-regression.md) と ADR-NNNN だけ",
  },
  {
    name: "proxy-hops-env-only-in-request-context",
    within: ["src/**"],
    allowedIn: ["src/request-context.ts"],
    matchers: [{ kind: "member", paths: ["process.env.AUTH_TRUSTED_PROXY_HOPS"] }],
    message:
      "AUTH_TRUSTED_PROXY_HOPS を読むのは request-context.ts だけ (boot guard も proxyTrustFromEnv を通る)",
  },
  {
    name: "app-fetch-only-in-entry-files",
    within: ["src/**", "testing/**"],
    allowedIn: ["src/worker.ts", "testing/bun-server.ts"],
    matchers: [{ kind: "member", paths: ["app.fetch"], callOnly: true }],
    message:
      "app に request を渡すのは、client の IP の header を入口で置き直す 2 つの入口 (src/worker.ts・testing/bun-server.ts) だけ",
  },
  {
    name: "service-key-env-only-in-service-key",
    within: ["src/**", "testing/**"],
    allowedIn: ["src/service-key.ts", "testing/server.ts"],
    matchers: [
      {
        kind: "member",
        paths: ["process.env.AUTH_SERVICE_KEY", "process.env.AUTH_SERVICE_KEY_PREVIOUS"],
      },
    ],
    message:
      "AUTH_SERVICE_KEY を読むのは service-key.ts と Bun の入口の boot guard (testing/server.ts) だけ",
  },
  {
    name: "service-key-compare-only-in-timing-safe-equal",
    within: ["src/service-key.ts"],
    matchers: [
      { kind: "member", paths: [".includes"], callOnly: true },
      {
        kind: "custom",
        visitors: (report) => ({
          BinaryExpression: (node) => {
            if (
              (node.operator === "===" || node.operator === "!==") &&
              (node.left?.name === "presented" || node.right?.name === "presented")
            ) {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "service key の比較は timingSafeEqual (digest 経由) だけで、includes や === を使わない",
  },
  {
    name: "service-key-header-only-in-app",
    within: ["src/**"],
    allowedIn: ["src/app.ts"],
    matchers: [{ kind: "literal", pattern: /^X-Service-Key$/ }],
    message: "X-Service-Key の header を読むのは app.ts の /rpc/* の middleware だけ",
  },
  {
    name: "no-hand-written-error-body",
    within: ["src/**"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          CallExpression: (node) => {
            const [body] = node.arguments ?? [];
            const [first] = body?.type === "ObjectExpression" ? (body.properties ?? []) : [];
            if (
              memberPathOf(node.callee) === "c.json" &&
              (first?.key?.name ?? "").startsWith("error")
            ) {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "応答の失敗の body (c.json({ error: … })) を手で書かない。失敗の class の httpApiStatus と adapter が応答を作る",
  },
  {
    name: "sentry-sdk-import-only-in-init-files",
    within: ["src/**", "testing/**"],
    allowedIn: ["src/sentry-cloudflare.ts", "src/worker.ts", "testing/sentry-bun.ts"],
    matchers: [{ kind: "valueImport", source: /^@sentry\// }],
    message:
      "Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ (共通の sentry.ts から import すると Workers の bundle に @sentry/bun が混ざる)",
  },
  {
    name: "listed-mfa-import-only-in-auth-plugins",
    within: ["src/auth-plugins/**"],
    allowedMatches: {
      "src/auth-plugins/mfa-challenge.ts": [
        "../mfa/redirect-guard",
        "../mfa/totp/challenge-required",
        "../mfa/totp/login-challenge",
      ],
      "src/auth-plugins/primary-auth.ts": ["../mfa/kill-switch"],
    },
    matchers: [{ kind: "valueImport", source: /(^|\/)mfa\// }],
    message:
      "ログインの経路 (auth-plugins) が import してよい mfa の module は、決まった file の決まった 4 つだけ",
  },
  {
    name: "mfa-kill-switch-env-only-in-primary-auth",
    within: ["src/**", "web/src/**"],
    allowedIn: ["src/auth-plugins/primary-auth.ts"],
    matchers: [
      { kind: "identifier", names: ["MFA_CHALLENGE_ENABLED"] },
      { kind: "literal", pattern: /MFA_CHALLENGE_ENABLED/ },
    ],
    message:
      "MFA の kill switch の env を読むのは一次認証の after-hook (primary-auth.ts) だけ (program は引数で受ける)",
  },
  {
    name: "no-hand-written-cookie-attribute",
    within: ["src/mfa/**", "src/auth-wiring.ts"],
    matchers: [{ kind: "literal", pattern: /Max-Age=|HttpOnly|SameSite=/ }],
    message:
      "session cookie は hono の serialize で組み、属性 (Max-Age・HttpOnly・SameSite) を手で書かない",
  },
  {
    name: "mfa-totp-repo-only-in-listed-files",
    within: ["src/**", "management/**"],
    allowedIn: [
      "src/id-generator.ts",
      "src/mfa/totp/enroll-mfa.ts",
      "src/mfa/totp/ports.ts",
      "src/mfa/totp/wiring.ts",
    ],
    matchers: [{ kind: "literal", pattern: /db\/repositories\/mfa-totp/ }],
    message: "db/repositories/mfa-totp を import する本番の code は決まった file だけ",
  },
  {
    name: "login-cookie-name-only-in-login-challenge",
    within: ["src/**", "web/src/**"],
    allowedIn: ["src/mfa/totp/login-challenge.ts"],
    matchers: [{ kind: "literal", pattern: /mfa_login_challenge/ }],
    message: "MFA チャレンジの cookie の名前の文字列は login-challenge.ts だけが持つ",
  },
  {
    name: "find-mfa-totp-only-in-listed-files",
    within: ["src/**", "db/**", "management/**"],
    allowedIn: [
      "db/repositories/mfa-totp.ts",
      "src/mfa/totp/activate-mfa.ts",
      "src/mfa/totp/enroll-mfa.ts",
      "src/mfa/totp/verify-code.ts",
    ],
    matchers: [{ kind: "identifier", names: ["findMfaTotp"] }],
    message: "secret を返す findMfaTotp を使う code は決まった file だけ",
  },
  {
    name: "verified-at-only-in-mfa-policy",
    within: ["src/**", "web/src/**", "management/**"],
    allowedIn: ["src/mfa/policy.ts"],
    matchers: [{ kind: "identifier", names: ["verifiedAt"] }],
    message:
      "MFA の verifiedAt を読む本番の code は src/mfa/policy.ts だけ (有効かの判定を 1 つの述語に集める)",
  },
  {
    name: "listed-import-only-in-management",
    within: ["management/**"],
    allowedMatches: {
      "management/disable-user-mfa.ts": ["../src/boot", "../src/mfa/totp/disable-mfa"],
      "management/sweep-abandoned-signups.ts": [
        "../src/account/sweep-abandoned-signups",
        "../src/boot",
      ],
    },
    matchers: [{ kind: "valueImport", source: /^((\.\.\/)+(src|db)\/|@\/|@core\/)/ }],
    message:
      "management/ が import してよい src と db の module は、決まった file の決まったものだけ",
  },
  {
    name: "no-src-import-in-db",
    within: ["db/**"],
    matchers: [{ kind: "literal", pattern: /^(\.\.\/)+src\// }],
    message: "db/ は src/ を import しない (identity DB を分離する時に逆向きの依存を作らない)",
  },
  {
    name: "no-import-in-mfa-policy",
    within: ["src/mfa/policy.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({ ImportDeclaration: report }),
      },
    ],
    message:
      "MFA の有効の述語 (src/mfa/policy.ts) は何も import しない (verified_at を直接比べる第 2 の判定の経路を生やさない)",
  },
  {
    name: "no-hono-in-guard",
    within: [
      "src/membership/guard/**",
      "src/membership/policy.ts",
      "src/invitation/accept.ts",
      "src/invitation/policy.ts",
    ],
    matchers: [{ kind: "literal", pattern: /^hono(\/.*)?$/ }],
    message: "Guard 層は型も値も hono を import しない (Hono に依存しない操作単位の認可)",
  },
  {
    name: "verified-only-in-guard",
    within: PRODUCTION_ROOTS,
    allowedIn: ["src/membership/guard/**"],
    matchers: [
      { kind: "identifier", names: ["verified"], callOnly: true },
      { kind: "typeAssertion", typePrefix: "Verified" },
    ],
    message: "guard を通った印 (Verified) を付けられるのは guard (src/membership/guard/) だけ",
  },
  {
    name: "account-deletion-only-in-delete-account",
    within: ["src/**"],
    allowedIn: ["src/account/delete-account.ts"],
    matchers: [
      {
        kind: "identifier",
        names: ["findCompaniesBlockingUserDeletion", "lockOwnerMembershipsOfUserCompanies"],
      },
      { kind: "identifier", names: ["deleteSessionsOf"], callOnly: true },
      { kind: "member", paths: [".deleteUser"], callOnly: true },
    ],
    message:
      "退会の判定 (sole OWNER の検査と OWNER 行の lock)、user の削除、commit 後の session の削除を呼ぶのは delete-account.ts だけ",
  },
  {
    name: "delete-account-only-in-delete-account-and-orphan",
    within: ["src/**"],
    allowedIn: ["src/account/delete-account.ts", "src/account/orphan.ts"],
    matchers: [{ kind: "identifier", names: ["deleteAccount"], callOnly: true }],
    message: "deleteAccount を呼ぶのは delete-account.ts と orphan.ts だけ",
  },
  {
    name: "no-unordered-owner-lock",
    within: ["db/repositories/membership.ts"],
    matchers: [{ kind: "literal", pattern: /(?<!ORDER BY id )FOR UPDATE/ }],
    message:
      "OWNER 行の lock は全て id 順に取る (ORDER BY id FOR UPDATE。順が違うと deadlock する)",
  },
  {
    name: "no-better-auth-delete-user",
    within: ["src/auth.ts"],
    matchers: [{ kind: "identifier", names: ["deleteUser"] }],
    message:
      "better-auth の退会の endpoint (deleteUser) を有効にしない。退会は delete-account.ts の use-case が行う",
  },
  {
    name: "delete-user-sessions-only-in-delete-sessions",
    within: ["src/**"],
    allowedIn: ["src/account/delete-sessions.ts", "src/auth-wiring.ts"],
    matchers: [{ kind: "member", paths: [".deleteUserSessions"], callOnly: true }],
    message: "deleteUserSessions を呼ぶのは delete-sessions.ts と auth-wiring.ts だけ",
  },
  {
    name: "route-literals-only-in-primary-auth-routes",
    within: ["src/auth-plugins/**"],
    allowedIn: ["src/auth-plugins/primary-auth-routes.ts"],
    matchers: [{ kind: "literal", pattern: /^(github|\/callback\/:id|\/magic-link\/verify)$/ }],
    message:
      "一次認証の route と provider の文字列を比べるのは primary-auth-routes.ts だけ (parser を 1 本に集める)",
  },
  {
    name: "display-text-cast-only-in-sanitize",
    within: ["src/**"],
    allowedIn: ["src/email/sanitize.ts"],
    matchers: [{ kind: "typeAssertion", typePrefix: "DisplayText" }],
    message:
      "メールの表示名は DisplayText を通す。DisplayText への cast は sanitize.ts の toDisplayText だけ",
  },
  {
    name: "health-ping-only-in-probe",
    within: ["src/**"],
    allowedIn: ["src/health/probe.ts"],
    matchers: [{ kind: "member", paths: [".pingDatabase", ".ping"], callOnly: true }],
    message: "/health の probe (pingDatabase・ping) を呼ぶのは src/health/probe.ts だけ",
  },
  {
    name: "no-catch-in-health-drivers",
    within: ["db/repositories/health.ts", "src/ttl-store.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          CatchClause: report,
          Identifier: (node) => {
            if ((node.name ?? "").startsWith("catch")) {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "health の repository と driver は失敗を握らない (catch を書かない)。失敗は probe が受ける",
  },
  {
    name: "health-route-only-in-health-handler",
    within: ["src/app.ts"],
    matchers: [
      { kind: "literal", pattern: /^\.\/(health\/ports|ttl-store-service)$/ },
      {
        kind: "custom",
        visitors: (report) => ({
          CallExpression: (node) => {
            if (
              memberPathOf(node.callee) === "app.get" &&
              stringOf(node.arguments?.[0]) === "/health"
            ) {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "app.ts は /health を handlers/health に任せ、route を直接書かず、probe の service (health/ports・ttl-store-service) を触らない",
  },
  {
    name: "no-direct-runtime-in-health-handler",
    within: ["src/handlers/health.ts"],
    matchers: [
      { kind: "member", paths: ["Effect.runPromise"] },
      { kind: "identifier", names: ["getRuntime"], callOnly: true },
    ],
    message: "handlers/health.ts は runRoute で走らせ、runtime を直接呼ばない",
  },
  {
    name: "local-hostname-check-only-in-local-database",
    within: PRODUCTION_ROOTS,
    allowedIn: ["db/testing/local-database.ts"],
    includesTestFiles: true,
    matchers: [
      { kind: "member", paths: ["LOCAL_DATABASE_HOSTNAMES.has"], callOnly: true },
      {
        kind: "custom",
        visitors: (report) => ({
          NewExpression: (node) => {
            if (
              node.callee?.name === "URL" &&
              memberPathOf(withoutAssertion(node.arguments?.[0])) === "process.env.DATABASE_URL"
            ) {
              report(node);
            }
          },
        }),
      },
    ],
    message: "DATABASE_URL の向き先が local かを判定するのは db/testing/local-database.ts だけ",
  },
  {
    name: "create-user-only-in-test-user-use-case",
    within: PRODUCTION_ROOTS,
    allowedIn: ["src/auth-service.ts", "src/auth-wiring.ts", "testing/create-signed-in-user.ts"],
    matchers: [{ kind: "identifier", names: ["createUser"], callOnly: true }],
    message:
      "AuthApi.createUser を呼ぶのは、試験の利用者を作る use-case (testing/create-signed-in-user.ts) だけ (ADR-0020)",
  },
  {
    name: "app-env-only-in-outside-production-check",
    within: ["testing/**"],
    allowedIn: ["testing/serve-only-outside-production.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          Identifier: (node) => {
            if (node.name === "APP_ENV" && !isAppEnvPassedToOutsideProductionCheck(node.parent)) {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "testing/ で APP_ENV を読むのは、判定の file と isOutsideProduction に渡す行だけ (ADR-0021)",
  },
  {
    name: "no-io-resource-import-in-runtime",
    within: ["src/runtime.ts"],
    matchers: [{ kind: "valueImport", source: /^(@\/db\/client|\.\/ttl-store|pg)$/ }],
    message:
      "runtime.ts は db/client と ttl-store を値で import しない (Layer に I/O resource を持たせない。ADR-0011)",
  },
  {
    name: "current-company-write-only-in-testing-use-cases",
    within: ["testing/**"],
    allowedIn: ["testing/create-signed-in-user.ts", "testing/set-current-company.ts"],
    matchers: [
      {
        kind: "identifier",
        names: ["applyJoin", "applyRemoval", "applyCompanyRemoval", "switchCurrentCompany"],
        callOnly: true,
      },
      { kind: "member", paths: [".updateUserLastUsedCompany"], callOnly: true },
    ],
    message:
      "試験の module で現在の事業所を書き換えるのは、試験の利用者を作る use-case と現在の事業所を切り替える use-case だけ (ADR-0020)",
  },
  {
    name: "db-import-only-in-db",
    within: ["**"],
    allowedIn: ["db/**"],
    allowedMatches: {
      "src/auth.ts": ["db/client", "db/schema"],
      "src/worker.ts": ["db/client"],
    },
    matchers: [
      { kind: "importTarget", target: DB_ACCESS_TARGET, includesTypeImports: true },
      { kind: "importTarget", target: PG_TARGET },
    ],
    message:
      "DB への接触は db/ に閉じる (identity DB を別 process へ分けるため)。db/ の外は pg・drizzle-orm・db/client・db/schema を import せず、db/repositories を ports 経由で使う。例外は、better-auth の DB adapter を結線する src/auth.ts (db/client・db/schema) と、request ごとの pool を供給する src/worker.ts (db/client。ADR-0011) だけ",
  },
  {
    name: "db-value-import-only-in-db-in-tests",
    within: ["**/__tests__/**", "acceptance/**"],
    allowedIn: ["db/**"],
    includesTestFiles: true,
    matchers: [
      { kind: "importTarget", target: DB_ACCESS_TARGET },
      { kind: "importTarget", target: PG_TARGET },
    ],
    message:
      "test も pg・drizzle-orm・db/client・db/schema を値で import しない (型の import は可)。seed・観測・cleanup は db/testing/* を通す",
  },
  {
    name: "db-testing-import-only-in-listed-files",
    within: ["**"],
    allowedIn: ["db/**", "testing/**", "src/__tests__/test-db.ts", "e2e/fixtures.ts"],
    includesTestFiles: true,
    matchers: [{ kind: "importTarget", target: /^db\/testing(\/|$)/ }],
    message:
      "db/testing/* (test の seed・観測・cleanup) を値で import するのは、src の test の面 src/__tests__/test-db.ts (ADR-0017)、e2e の seed (e2e/fixtures.ts)、本番以外の entry の testing/** (ADR-0020・ADR-0022) だけ",
  },
  {
    name: "pg-import-only-in-db-client",
    within: ["db/**"],
    allowedIn: ["db/client.ts"],
    includesTestFiles: true,
    matchers: [{ kind: "importTarget", target: PG_TARGET }],
    message:
      "pg の Pool を作るのは db/client.ts だけ。workerd は別の request で開いた socket を再利用できないので、db は単一のまま、中の Pool を request ごとに差し替える (ADR-0011)",
  },
  {
    name: "tagged-error-only-in-failure",
    within: ["src/**"],
    allowedIn: ["src/failure.ts"],
    matchers: [{ kind: "member", paths: ["Schema.TaggedError"] }],
    message:
      "client に出る失敗の class は src/failure.ts の failure() で作る (status が必須で、表に無い status は型エラーになる)。Schema.TaggedError を直接書かない",
  },
  {
    name: "failure-only-in-failures-and-domain-errors",
    within: ["src/**"],
    allowedIn: ["src/failure.ts", "src/failures.ts", "src/*/errors.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report) => ({
          CallExpression: (node) => {
            if (node.callee?.type === "Identifier" && node.callee.name === "failure") {
              report(node);
            }
          },
        }),
      },
    ],
    message:
      "失敗の class の置き場は 2 つ: どの domain にも属さない失敗は src/failures.ts、domain の不変条件が破れた失敗はその domain の errors.ts。ほかの domain は、その errors.ts から import する",
  },
  {
    name: "boundary-error-construction-only-in-errors",
    within: ["src/**"],
    allowedIn: ["src/errors.ts"],
    matchers: [
      {
        kind: "identifier",
        names: ["DbError", "AuthApiError", "TtlStoreError", "EmailError"],
        callOnly: true,
      },
    ],
    message:
      "サードパーティ境界の失敗 (DbError・AuthApiError・TtlStoreError・EmailError) を作るのは src/errors.ts だけ。producer は tryDb・tryAuthApi・tryTtlStore・tryEmail と timeoutAsBoundary を使う",
  },
  {
    name: "effect-run-only-in-listed-files",
    within: ["src/**"],
    allowedIn: [
      "src/handlers/run-route.ts",
      "src/rpc/run-rpc.ts",
      "src/transaction.ts",
      "src/background.ts",
      "src/auth.ts",
      "src/auth-plugins/primary-auth.ts",
      "src/ttl-store-better-auth.ts",
    ],
    matchers: [
      {
        kind: "member",
        paths: [
          ".runPromise",
          ".runPromiseExit",
          ".runPromiseWith",
          ".runPromiseExitWith",
          ".runFork",
          ".runForkWith",
          ".runSync",
          ".runSyncExit",
          ".runCallback",
        ],
      },
    ],
    message:
      "Effect を走らせ、failure と defect を応答に変えるのは adapter (runRoute・runMiddleware・runRpc) だけ。ほかに走らせてよいのは、runtime の外から呼ばれる口 (transaction の callback、切り離した fiber、better-auth の hook) の file だけ。program は Effect を返す",
  },
  {
    name: "clock-and-id-only-in-services",
    within: ["src/**"],
    allowedIn: ["src/kv-store.do.ts", "src/kv-store.memory.ts", "src/id-generator.ts"],
    matchers: [{ kind: "member", paths: ["Date.now", "crypto.randomUUID", "Math.random"] }],
    message:
      "時刻は Clock.currentTimeMillis、ID は IdGenerator から取る (test が Layer で差し替える)。Date.now・crypto.randomUUID・Math.random を書けるのは、Effect の外で動く TTL store の driver と id-generator.ts だけ",
  },
  {
    name: "ttl-store-driver-import-only-in-entry-files",
    within: ["src/**"],
    allowedIn: ["src/worker.ts", "src/boot.ts"],
    matchers: [{ kind: "valueImport", source: /(^|\/)(ttl-store|kv-store\.(do|memory))$/ }],
    message:
      "TTL store は TtlStore の service で使う。driver (ttl-store・kv-store.*) を値で import して結線するのは entry (worker.ts・boot.ts) だけ",
  },
  {
    name: "email-send-only-in-email-wiring",
    within: ["src/**"],
    allowedIn: ["src/email/wiring.ts", "src/email/send-*.ts"],
    matchers: [
      { kind: "valueImport", source: /(^|\/)send-[a-z-]+$/ },
      { kind: "identifier", names: ["renderAndSendEmail"], callOnly: true },
    ],
    message:
      "メールは EmailSender の service で送る。send-* を値で import し、renderAndSendEmail を呼ぶのは email/wiring.ts と email/send-*.ts だけ",
  },
  {
    name: "connect-error-only-in-run-rpc",
    within: ["src/**"],
    allowedIn: ["src/rpc/run-rpc.ts"],
    matchers: [{ kind: "identifier", names: ["ConnectError"] }],
    message:
      "失敗を Connect の応答 (ConnectError) に変えるのは adapter の rpc/run-rpc.ts だけ。handler は failure class で失敗する",
  },
  {
    name: "no-with-headers-in-http-api",
    within: ["src/**"],
    matchers: [{ kind: "member", paths: ["HttpApiSchema.WithHeaders"] }],
    message:
      "HttpApiSchema.WithHeaders は複数の Set-Cookie を 1 本に連結するので使わない。better-auth の Set-Cookie は HttpEffect.appendPreResponseHandler で足す (request-http-api.ts の forwardSetCookies)",
  },
  {
    name: "no-services-or-utils-dir",
    within: ["src/**/services/**", "src/**/utils/**"],
    includesTestFiles: true,
    matchers: [{ kind: "custom", visitors: (report) => ({ Program: (node) => report(node) }) }],
    message:
      "services/ や utils/ のような、無関係な実装の寄せ集めの dir を作らない。変更理由を所有する domain の dir に置き、肥大化したら操作名で下位 dir を作る",
  },
  {
    name: "fixtures-import-only-in-seed",
    within: ["e2e/**"],
    allowedIn: ["e2e/seed.ts"],
    matchers: [{ kind: "valueImport", source: /(^|\/)fixtures$/ }],
    message:
      "e2e の spec は DB を import しない。fixtures.ts を import するのは seed.ts だけで、spec は helpers.ts の reseedFixture (子 process) で行を作り直す。spec の process に pg の Pool を開くと閉じる手段が無く、runner が止まらない",
  },
  {
    name: "page-route-only-in-contract-mock",
    within: ["e2e/**"],
    allowedIn: ["e2e/contract-mock.ts"],
    matchers: [{ kind: "member", paths: ["page.route", "context.route"], callOnly: true }],
    message:
      "SPA の API のモックは contract-mock.ts の routeEndpoint で張る (path と method を契約から取る)。契約の外の応答は routeOutsideContract で張る",
  },
  {
    name: "server-log-only-in-helpers",
    within: ["e2e/**"],
    allowedIn: ["e2e/helpers.ts"],
    matchers: [{ kind: "literal", pattern: /\.server\.log/ }],
    message:
      "送ったメールの URL は helpers.ts の sentLinkAfter で、その操作より後に log に出た行から読む (server の log は spec をまたいで残るので、同じ email の古い行を拾わないため)",
  },
  {
    name: "login-links-only-in-helpers",
    within: ["e2e/**"],
    allowedIn: ["e2e/helpers.ts"],
    matchers: [{ kind: "literal", pattern: /\/login-links/ }],
    message:
      "ログインは helpers.ts の signInWithMagicLink で行う (e2e 専用の試験 API から URL を取って開く)。ログイン画面から Magic Link を送るのは、その画面を確かめる spec だけ (signInThroughMagicLinkForm)",
  },
  {
    name: "declared-failure-only-in-contract-mock",
    within: ["e2e/**"],
    allowedIn: ["e2e/contract-mock.ts"],
    matchers: [{ kind: "identifier", names: ["_tag"] }],
    message:
      "契約で宣言した失敗の応答は contract-mock.ts の declaredFailure で作る (契約を変えると、モックを作る所で throw する)。契約に無い応答 (body の無い 500、遅延、abort) は応答だけを手で書く",
  },
  {
    name: "leave-spa-import-only-in-app",
    within: ["web/src/**"],
    allowedIn: ["web/src/app/**"],
    matchers: [{ kind: "valueImport", source: /(^|\/)leave-spa$/ }],
    message:
      "document を離れるのは application (web/src/app/**) だけ。page は結果を message で返し、application が document を読み直す (退会の成功は、表示中の page に関係なく application が受ける。認証の状態が変わった後は document を読み直す。ADR-0023 Decision 2)",
  },
  {
    name: "account-deleted-message-only-in-owning-page",
    within: ["web/src/**"],
    allowedIn: [
      "web/src/account/account-deletion.ts",
      "web/src/account/pages/Profile.ts",
      "web/src/company/company-deletion.ts",
      "web/src/company/pages/CompanySettings.ts",
      "web/src/company/pages/Companies.ts",
    ],
    matchers: [
      {
        kind: "member",
        paths: [
          ".SucceededDeleteAccount",
          ".SucceededDeleteLastCompany",
          ".SucceededLeaveLastCompany",
        ],
      },
    ],
    message:
      "退会が成功したかは、その message を持つ page の述語 (Profile.isAccountDeleted・Companies.isLastCompanyLeft・CompanySettings.isLastCompanyDeleted) で判定する。ほかの file で message を直接比べない",
  },
  {
    name: "company-change-message-only-in-owning-module",
    within: ["web/src/**"],
    allowedIn: [
      "web/src/company/add-company.ts",
      "web/src/company/company-deletion.ts",
      "web/src/company/pages/Companies.ts",
      "web/src/company/pages/CompanySettings.ts",
      "web/src/membership/ownership-transfer.ts",
    ],
    matchers: [
      {
        kind: "member",
        paths: [
          ".SucceededAddCompany",
          ".SucceededDeleteCompany",
          ".SucceededLeaveCompany",
          ".SucceededTransferOwnership",
          ".SucceededUpdateCompany",
        ],
      },
    ],
    message:
      "事業所を変えた成功かは、その message を持つ module の visitOfCompanyChange (Companies・CompanySettings が入れ子の分も返す) で判定する。ほかの file で message を直接比べない (page を離れた後に届いた成功で、application が事業所の状態を読み直す判定を迂回させない)",
  },
  {
    name: "failure-messages-not-exported",
    within: ["web/src/**"],
    allowedIn: ["web/src/shared/failure-message.ts", "web/src/mfa/mfa-failure-messages.ts"],
    matchers: [
      {
        kind: "custom",
        visitors: (report, _path, context) => {
          const tables = new Set<string>();
          const namesFailureMessages = (node: AstNode) =>
            /\bFailureMessages\b/.test(context.sourceCode.getText(node));
          return {
            VariableDeclarator: (node) => {
              if (node.id?.name !== undefined && namesFailureMessages(node)) {
                tables.add(node.id.name);
              }
            },
            ExportNamedDeclaration: (node) => {
              const declaration = node.declaration ?? undefined;
              if (
                (declaration !== undefined && namesFailureMessages(declaration)) ||
                (node.specifiers ?? []).some((each) => tables.has(each.local?.name ?? ""))
              ) {
                report(node);
              }
            },
          };
        },
      },
    ],
    message:
      "失敗の文言の表 (FailureMessages) は画面ごとに置き、export しない (同じ _tag でも画面ごとに意味が違う)。共有するのは MFA の表 (mfa/mfa-failure-messages.ts) だけ",
  },
  {
    name: "dialog-visible-only-by-is-dialog-visible",
    within: ["web/src/**/pages/**"],
    matchers: [{ kind: "member", paths: [".dialog.isOpen"] }],
    message:
      "dialog を描くかどうかは shared/ui/dialog-view.ts の isDialogVisible で決める (dialog は isOpen が false になった後も、閉じる animation が終わるまで描く)",
  },
  {
    name: "dialog-transition-state-only-in-dialog-view",
    within: ["web/src/**"],
    allowedIn: ["web/src/shared/ui/dialog-view.ts"],
    matchers: [{ kind: "member", paths: [".dialog.animation.transitionState"] }],
    message:
      "dialog が閉じる途中かどうかは shared/ui/dialog-view.ts の isDialogVisible で読む (Foldkit の Dialog の animation の状態を、ほかの file が直接比べない)",
  },
  {
    name: "dialog-held-report-only-in-dialog-view",
    within: ["web/src/**"],
    allowedIn: ["web/src/shared/ui/dialog-view.ts"],
    matchers: [{ kind: "member", paths: [".maybeOutMessageAfterClose"] }],
    message:
      "dialog が閉じた後に出す報告は shared/ui/dialog-view.ts の reportingDialogFoldsOf の closeThen と reportAfterClose で置く (置いた報告を、ほかの file が直接読まない)",
  },
  {
    name: "mfa-failure-messages-import-only-in-mfa",
    within: ["web/src/**"],
    allowedIn: ["web/src/mfa/**"],
    matchers: [{ kind: "valueImport", source: /(^|\/)mfa-failure-messages$/ }],
    message:
      "MFA の失敗の文言の表 (mfa/mfa-failure-messages.ts) を使うのは MFA の画面 (web/src/mfa/**) だけ。同じ失敗に同じ文言を出すために共有している",
  },
  {
    name: "sdk-import-only-peer-dependencies",
    within: ["packages/auth-client/src/**"],
    matchers: [
      {
        kind: "custom",
        visitors: (report, _path, context) =>
          importVisitors(
            (source) =>
              source.startsWith(".") ||
              sdkPeerDependencies(context.filename).includes(packageNameOf(source))
                ? undefined
                : source,
            "valueAndType",
            report,
          ),
      },
    ],
    message:
      "SDK が import できる外部 package は packages/auth-client/package.json の peerDependencies だけ (型の import も .d.ts に出る)。consumer の framework (Next.js・React・Node) と transport に依存させない (ADR-0028)",
  },
];

const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "fetch",
]);

const TIMER_GLOBALS = new Set(["setTimeout", "setInterval", "requestAnimationFrame"]);

const CLOCK_AND_RANDOM_CALLS = new Set(["Date.now", "Math.random", "crypto.randomUUID"]);

const FORM_ELEMENTS = new Set(["button", "input", "textarea", "select"]);

const APPLICATION_STARTS = new Set(["Runtime.makeApplication", "Runtime.run"]);

const DEFERRED_EFFECT_CONSTRUCTORS = new Set(
  ["sync", "try", "tryPromise", "promise", "suspend", "callback"].map((name) => `Effect.${name}`),
);

const isExecuteProperty = (node: AstNode) =>
  node.type === "Property" && node.key?.name === "execute";

const isDeferredEffectCall = (node: AstNode) =>
  node.type === "CallExpression" && DEFERRED_EFFECT_CONSTRUCTORS.has(memberPathOf(node.callee));

const isDeferredByRuntime = (node: AstNode) =>
  isExecuteProperty(node) || isDeferredEffectCall(node);

const isDeclaredIn = (scope: Scope | null, name: string): boolean =>
  scope !== null && (scope.set.has(name) || isDeclaredIn(scope.upper, name));

const namedNode = (parent: AstNode | undefined) =>
  parent?.type === "MemberExpression" ? parent.property : parent?.key;

const isPropertyName = (node: AstNode) =>
  node.parent?.computed !== true && namedNode(node.parent) === node;

const isGlobalReference = (context: RuleContext, node: AstNode, name: string) =>
  !isPropertyName(node) && !isDeclaredIn(context.sourceCode.getScope(node), name);

const inFoldkitFiles = (create: (context: RuleContext) => Visitors) => ({
  create: (context: RuleContext): Visitors => {
    let isFoldkitFile = false;
    const visitors = Object.entries(create(context)).map(([selector, visit]) => [
      selector,
      (node: AstNode) => {
        if (isFoldkitFile) {
          visit(node);
        }
      },
    ]);
    return Object.fromEntries([
      [
        "Program",
        (node: AstNode) => {
          isFoldkitFile = importsFoldkit(node);
        },
      ],
      ...visitors,
    ]);
  },
});

const noEffectRunInWeb = {
  create: (context: RuleContext): Visitors => ({
    MemberExpression: (node) => {
      if (!memberPathOf(node).startsWith("Effect.run")) {
        return;
      }
      context.report({
        node,
        message:
          "web の画面は Effect を自分で走らせない。Foldkit の update か init が Command を返し、runtime が走らせる",
      });
    },
  }),
};

const noBrowserGlobalOutsideCommand = inFoldkitFiles((context) => ({
  Identifier: (node) => {
    const name = node.name ?? "";
    if (
      !BROWSER_GLOBALS.has(name) ||
      !isGlobalReference(context, node, name) ||
      context.sourceCode.getAncestors(node).some(isDeferredByRuntime)
    ) {
      return;
    }
    context.report({
      node,
      message: `Foldkit の update・view・init は ${name} に触れない。Command の execute か、Effect.sync などの中に置く`,
    });
  },
}));

const noTimerClockRandomInFoldkit = inFoldkitFiles((context) => ({
  Identifier: (node) => {
    const name = node.name ?? "";
    if (!TIMER_GLOBALS.has(name) || !isGlobalReference(context, node, name)) {
      return;
    }
    context.report({
      node,
      message: `Foldkit の file は ${name} を使わない。待つのは Effect.sleep、次の描画は Foldkit の Subscription で書く`,
    });
  },
  MemberExpression: (node) => {
    const path = memberPathOf(node);
    if (!CLOCK_AND_RANDOM_CALLS.has(path)) {
      return;
    }
    context.report({
      node,
      message: `Foldkit の file は ${path} を使わない。時刻は Clock、乱数と ID は Random か SecureRandom を Command の中で使う`,
    });
  },
}));

const noAtomImportInFoldkit = inFoldkitFiles((context) => ({
  ImportDeclaration: (node) => {
    if (!/-atom(\.tsx?)?$/.test(stringOf(node.source) ?? "")) {
      return;
    }
    context.report({
      node,
      message: "Foldkit の file は *-atom.ts を import しない。状態は Model、通信は Command に置く",
    });
  },
}));

const noRawFormElement = {
  create: (context: RuleContext): Visitors => ({
    MemberExpression: (node) => {
      if (
        node.computed === true ||
        node.object?.name !== "h" ||
        !FORM_ELEMENTS.has(node.property?.name ?? "")
      ) {
        return;
      }
      context.report({
        node,
        message: `h.${node.property?.name} は shared/ui/ の部品だけが書く。画面は shared/ui/ の部品を使う`,
      });
    },
  }),
};

const APPLICATION_START_MESSAGE =
  "は app/start-application.ts の startApplication だけが呼ぶ (resources の渡し忘れを型で止めるため)";

const noDirectApplicationStart = {
  create: (context: RuleContext): Visitors => ({
    MemberExpression: (node) => {
      const path = memberPathOf(node);
      if (!APPLICATION_STARTS.has(path)) {
        return;
      }
      context.report({ node, message: `${path} ${APPLICATION_START_MESSAGE}` });
    },
    ImportDeclaration: (node) => {
      if ((stringOf(node.source) ?? "") !== "foldkit/runtime") {
        return;
      }
      const started = (node.specifiers ?? []).find((specifier) =>
        APPLICATION_STARTS.has(`Runtime.${specifier.imported?.name}`),
      );
      if (started === undefined) {
        return;
      }
      context.report({
        node: started,
        message: `${started.imported?.name} ${APPLICATION_START_MESSAGE}`,
      });
    },
  }),
};

export default {
  meta: { name: "taimei" },
  rules: {
    ...Object.fromEntries(ROWS.map((row) => [row.name, ruleOf(row)])),
    "no-effect-run-in-web": noEffectRunInWeb,
    "no-browser-global-outside-command": noBrowserGlobalOutsideCommand,
    "no-timer-clock-random-in-foldkit": noTimerClockRandomInFoldkit,
    "no-atom-import-in-foldkit": noAtomImportInFoldkit,
    "no-raw-form-element": noRawFormElement,
    "no-direct-application-start": noDirectApplicationStart,
  },
};
