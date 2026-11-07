type AstNode = {
  readonly type: string;
  readonly name?: string;
  readonly computed?: boolean;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly key?: AstNode;
  readonly callee?: AstNode;
  readonly source?: { readonly value?: unknown };
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
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "fetch",
]);

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

const isFoldkitImport = (node: AstNode) => /^(foldkit|@foldkit\/)/.test(String(node.source?.value));

const noEffectRunInWeb = {
  create: (context: RuleContext): Visitors => ({
    MemberExpression: (node) => {
      if (!staticMemberPath(node).startsWith("Effect.run")) return;
      context.report({
        node,
        message:
          "web の画面は Effect を自分で走らせない。Foldkit の update か init が Command を返し、runtime が走らせる",
      });
    },
  }),
};

const touchesBrowserFromDecision = (context: RuleContext, node: AstNode, name: string) =>
  !isPropertyName(node) &&
  !isDeclaredIn(context.sourceCode.getScope(node), name) &&
  !context.sourceCode.getAncestors(node).some(isDeferredByRuntime);

const noBrowserGlobalOutsideCommand = {
  create: (context: RuleContext): Visitors => {
    let importsFoldkit = false;
    return {
      ImportDeclaration: (node) => {
        importsFoldkit ||= isFoldkitImport(node);
      },
      Identifier: (node) => {
        const name = node.name ?? "";
        if (!importsFoldkit || !BROWSER_GLOBALS.has(name)) return;
        if (!touchesBrowserFromDecision(context, node, name)) return;
        context.report({
          node,
          message: `Foldkit の update・view・init は ${name} に触れない。Command の execute か、Effect.sync などの中に置く`,
        });
      },
    };
  },
};

export default {
  meta: { name: "taimei" },
  rules: {
    "no-effect-run-in-web": noEffectRunInWeb,
    "no-browser-global-outside-command": noBrowserGlobalOutsideCommand,
  },
};
