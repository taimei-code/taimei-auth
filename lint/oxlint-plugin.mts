type AstNode = {
  readonly type: string;
  readonly name?: string;
  readonly computed?: boolean;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly key?: AstNode;
  readonly callee?: AstNode;
  readonly imported?: AstNode;
  readonly source?: { readonly value?: unknown };
  readonly specifiers?: readonly AstNode[];
  readonly body?: readonly AstNode[];
  readonly parent?: AstNode;
};

type Scope = {
  readonly set: ReadonlyMap<string, unknown>;
  readonly upper: Scope | null;
};

type RuleContext = {
  readonly report: (descriptor: { readonly node: AstNode; readonly message: string }) => void;
  readonly sourceCode: {
    readonly getAncestors: (node: AstNode) => readonly AstNode[];
    readonly getScope: (node: AstNode) => Scope;
  };
};

type Visitors = Readonly<Record<string, (node: AstNode) => void>>;

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

const NOT_A_MEMBER = "";

const staticMemberPath = (node: AstNode | undefined): string =>
  node?.type === "MemberExpression" && node.computed !== true
    ? `${node.object?.name}.${node.property?.name}`
    : NOT_A_MEMBER;

const isExecuteProperty = (node: AstNode) =>
  node.type === "Property" && node.key?.name === "execute";

const isDeferredEffectCall = (node: AstNode) =>
  node.type === "CallExpression" && DEFERRED_EFFECT_CONSTRUCTORS.has(staticMemberPath(node.callee));

const isDeferredByRuntime = (node: AstNode) =>
  isExecuteProperty(node) || isDeferredEffectCall(node);

const isDeclaredIn = (scope: Scope | null, name: string): boolean =>
  scope !== null && (scope.set.has(name) || isDeclaredIn(scope.upper, name));

const namedNode = (parent: AstNode | undefined) =>
  parent?.type === "MemberExpression" ? parent.property : parent?.key;

const isPropertyName = (node: AstNode) =>
  node.parent?.computed !== true && namedNode(node.parent) === node;

const importSource = (node: AstNode) => String(node.source?.value);

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
          isFoldkitFile = (node.body ?? []).some(
            (statement) =>
              statement.type === "ImportDeclaration" &&
              /^(foldkit|@foldkit\/)/.test(importSource(statement)),
          );
        },
      ],
      ...visitors,
    ]);
  },
});

const noEffectRunInWeb = {
  create: (context: RuleContext): Visitors => ({
    MemberExpression: (node) => {
      if (!staticMemberPath(node).startsWith("Effect.run")) {
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
    const path = staticMemberPath(node);
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
    if (!/-atom(\.tsx?)?$/.test(importSource(node))) {
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
      const path = staticMemberPath(node);
      if (!APPLICATION_STARTS.has(path)) {
        return;
      }
      context.report({ node, message: `${path} ${APPLICATION_START_MESSAGE}` });
    },
    ImportDeclaration: (node) => {
      if (importSource(node) !== "foldkit/runtime") {
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
    "no-effect-run-in-web": noEffectRunInWeb,
    "no-browser-global-outside-command": noBrowserGlobalOutsideCommand,
    "no-timer-clock-random-in-foldkit": noTimerClockRandomInFoldkit,
    "no-atom-import-in-foldkit": noAtomImportInFoldkit,
    "no-raw-form-element": noRawFormElement,
    "no-direct-application-start": noDirectApplicationStart,
  },
};
