import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Option } from "effect";
import {
  expect as expectScene,
  given as givenScene,
  role,
  scene,
  tap,
  within,
} from "foldkit/scene";
import { fromString } from "foldkit/url";

import * as CurrentCompany from "../web/src/account/current-company";
import { init, Message, type Model, update, view } from "../web/src/app/account/main";
import * as Companies from "../web/src/company/pages/Companies";
import * as CompanySettings from "../web/src/company/pages/CompanySettings";

const REPO_ROOT = join(import.meta.dir, "..");
const ORIGIN = "https://auth.taimei-code.com";

const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" });

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  run("git", ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const gitFiles = (...pathspecs: string[]): string[] =>
  run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const testBlocksIn = (path: string): string[] =>
  readFileSync(join(REPO_ROOT, path), "utf8")
    .split(/\btest(?:\.each\([\s\S]*?\))?\(/)
    .slice(1);

const count = (text: string, word: string) => text.split(word).length - 1;

const urlOf = (href: string) =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

const COMPANY_A = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const COMPANY_B = {
  companyId: "company-b",
  companyName: "事業所B",
  orgCode: "PERSONAL",
  role: "ADMIN",
} as const;

const COMPANY_C = {
  companyId: "company-c",
  companyName: "事業所C",
  orgCode: "PERSONAL",
  role: "ADMIN",
} as const;

type Membership = typeof COMPANY_A | typeof COMPANY_B | typeof COMPANY_C;

const stateOf = (currentCompanyId: string, memberships: ReadonlyArray<Membership>) => ({
  maybeCurrentCompanyId: Option.some(currentCompanyId),
  memberships,
});

const ready = (
  path: string,
  state = stateOf(COMPANY_A.companyId, [COMPANY_A, COMPANY_B]),
): Model =>
  update(init(urlOf(`${ORIGIN}${path}`)).model, Message.SucceededLoadCompanyState({ state }))
    .model;

type AnyCommand = { name: string; args?: Record<string, unknown> };

const commandsOf = (result: { commands?: ReadonlyArray<unknown> }) =>
  (result.commands ?? []) as ReadonlyArray<AnyCommand>;

const currentCompanyMessage = (message: CurrentCompany.Message) =>
  Message.GotCurrentCompanyMessage({ message });

const companiesMessage = (message: Companies.Message) => Message.GotCompaniesMessage({ message });

const companySettingsMessage = (message: CompanySettings.Message) =>
  Message.GotCompanySettingsMessage({ message });

const currentStateOf = (model: Model) =>
  model.entry._tag === "Ready" ? model.entry.currentCompany.state : undefined;

const pageVisitOf = (model: Model): number =>
  Option.match(model.maybePage, {
    onNone: () => -1,
    onSome: (page) => ("visit" in page.model ? (page.model.visit as number) : -1),
  });

const SIDEBAR_LINKS = [
  { name: "所属事業所", path: "/account/companies" },
  { name: "メンバー", path: "/account/members" },
  { name: "事業所設定", path: "/account/company-settings" },
  { name: "プロフィール", path: "/account" },
  { name: "セキュリティ", path: "/account/security" },
  { name: "セッション", path: "/account/sessions" },
  { name: "連携アカウント", path: "/account/connections" },
] as const;

const BASE_LINK_CLASSES = [
  "flex",
  "items-center",
  "gap-2",
  "rounded-md",
  "px-3",
  "py-2",
  "text-sm",
  "font-medium",
  "text-muted-foreground",
  "transition-colors",
  "hover:bg-accent",
  "hover:text-accent-foreground",
  "[&_svg]:size-4",
];

const CURRENT_LINK_CLASSES = [...BASE_LINK_CLASSES, "bg-accent", "text-accent-foreground"];

type VNodeLike = {
  data?: {
    class?: Record<string, boolean>;
    attrs?: Record<string, unknown>;
    props?: Record<string, unknown>;
  };
};

const attributeOf = (vnode: VNodeLike, name: string): string | undefined => {
  const value = vnode.data?.attrs?.[name] ?? vnode.data?.props?.[name];
  return typeof value === "string" ? value : undefined;
};

const VARIANT = /^(data|aria)-\[([a-z-]+)(?:=([^\]]+))?\]:(.+)$/;

const appliedClasses = (vnode: VNodeLike): string[] =>
  Object.entries(vnode.data?.class ?? {})
    .filter(([, isActive]) => isActive)
    .map(([token]) => token)
    .flatMap((token) => {
      const variant = VARIANT.exec(token);
      if (variant === null) {
        return [token];
      }
      const [, kind, key, expected, utility] = variant;
      const actual = attributeOf(vnode, `${kind}-${key}`);
      const holds = actual !== undefined && (expected === undefined || actual === expected);
      return holds && utility !== undefined ? [utility] : [];
    })
    .sort();

describe("サイドバーの nav", () => {
  test.each(SIDEBAR_LINKS)(
    "AC-001: $path を開くと、7 つのリンクが aria-label の付いた nav の中にある",
    ({ path }) => {
      scene(
        { update, view },
        givenScene(ready(path)),
        expectScene(role("navigation")).toHaveAttr("aria-label"),
        tap(({ html }) => {
          expect(
            Option.getOrUndefined(
              Option.flatMap(role("navigation")(html), (nav) =>
                Option.some(attributeOf(nav as VNodeLike, "aria-label") ?? ""),
              ),
            ),
          ).not.toBe("");
        }),
        ...SIDEBAR_LINKS.map((link) =>
          expectScene(within(role("navigation"), role("link", { name: link.name }))).toExist(),
        ),
      );
    },
  );

  test.each(SIDEBAR_LINKS)(
    "AC-002: $path を開くと、$name のリンクだけが aria-current=page を持つ",
    ({ path, name }) => {
      scene(
        { update, view },
        givenScene(ready(path)),
        ...SIDEBAR_LINKS.map((link) =>
          link.name === name
            ? expectScene(role("link", { name: link.name })).toHaveAttr("aria-current", "page")
            : expectScene(role("link", { name: link.name })).not.toHaveAttr("aria-current"),
        ),
      );
    },
  );

  test.each(SIDEBAR_LINKS)(
    "AC-003: $path を開くと、表示中と表示中でないリンクに当たる class が今と同じである",
    ({ path, name }) => {
      scene(
        { update, view },
        givenScene(ready(path)),
        tap(({ html }) => {
          for (const link of SIDEBAR_LINKS) {
            const vnode = Option.getOrThrow(role("link", { name: link.name })(html)) as VNodeLike;
            expect(appliedClasses(vnode)).toEqual(
              [...(link.name === name ? CURRENT_LINK_CLASSES : BASE_LINK_CLASSES)].sort(),
            );
          }
        }),
      );
    },
  );

  test("AC-004: web/src に aria-current と data-status を手で付ける書き方が無い", () => {
    expect(
      gitGrep(String.raw`AriaCurrent\(|DataAttribute\("status"|data-status|status=active`, "web/src"),
    ).toEqual([]);
  });
});

const SWITCHED_TO_B = { maybeDoneText: Option.none(), actionText: "事業所を切り替えました" };

const twoRefreshesRequested = (): Model =>
  [
    currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
    currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
  ].reduce((current, each) => update(current, each).model, ready("/account"));

describe("現在の事業所の読み直しの順序", () => {
  test("AC-005: 1 回目の成功の後に 2 回目の失敗が届くと、画面は 1 回目の結果になる", () => {
    const afterFirst = update(
      twoRefreshesRequested(),
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateOf(COMPANY_B.companyId, [COMPANY_A, COMPANY_B]),
          maybeDoneText: SWITCHED_TO_B.maybeDoneText,
        }),
      ),
    ).model;
    const afterSecond = update(
      afterFirst,
      currentCompanyMessage(
        CurrentCompany.Message.FailedRefreshCompanyState({
          refreshNumber: 2,
          failure: "Unexpected",
          actionText: SWITCHED_TO_B.actionText,
        }),
      ),
    ).model;
    expect(currentStateOf(afterSecond)?.maybeCurrentCompanyId).toEqual(
      Option.some(COMPANY_B.companyId),
    );
  });

  test("AC-006: 2 回目の成功の後に 1 回目の成功が届いても、画面は 2 回目の結果のままである", () => {
    const afterSecond = update(
      twoRefreshesRequested(),
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 2,
          state: stateOf(COMPANY_B.companyId, [COMPANY_A, COMPANY_B]),
          maybeDoneText: Option.none(),
        }),
      ),
    ).model;
    const afterFirst = update(
      afterSecond,
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateOf(COMPANY_A.companyId, [COMPANY_A, COMPANY_B]),
          maybeDoneText: Option.none(),
        }),
      ),
    ).model;
    expect(currentStateOf(afterFirst)?.maybeCurrentCompanyId).toEqual(
      Option.some(COMPANY_B.companyId),
    );
  });

  test("AC-007: web/src の story test に、成功と失敗の順序と、成功 2 回の順序の test がある", () => {
    const blocks = gitFiles(":(glob)web/src/**/*.story.test.ts").flatMap(testBlocksIn);
    expect(
      blocks.some(
        (block) =>
          block.includes("SucceededRefreshCompanyState") &&
          block.includes("FailedRefreshCompanyState"),
      ),
    ).toBe(true);
    expect(blocks.some((block) => count(block, "SucceededRefreshCompanyState") >= 2)).toBe(true);
  });
});

const LEAVE_ORDER = [COMPANY_B, COMPANY_A, COMPANY_C];

const leftCompanyB = (): Model => {
  const signedIn = update(
    ready("/account/companies", stateOf(COMPANY_A.companyId, LEAVE_ORDER)),
    companiesMessage(
      Companies.Message.CompletedReadSignedInUserId({
        visit: 1,
        maybeUserId: Option.some("user-self"),
      }),
    ),
  ).model;
  const leaving = update(
    signedIn,
    companiesMessage(Companies.Message.ClickedLeaveCompany({ membership: COMPANY_B })),
  ).model;
  return update(
    leaving,
    companiesMessage(
      Companies.Message.SucceededLeaveCompany({
        visit: pageVisitOf(leaving),
        companyName: COMPANY_B.companyName,
      }),
    ),
  ).model;
};

const latestRefreshNumberOf = (model: Model): number =>
  model.entry._tag === "Ready" ? model.entry.currentCompany.refreshNumber : -1;

describe("事業所から抜けた後の読み直しまでの操作", () => {
  test("AC-008: 離脱が成功してから読み直しが届くまで、抜けた行の「抜ける」を押せない", () => {
    scene(
      { update, view },
      givenScene(leftCompanyB()),
      expectScene(role("button", { name: "抜ける" })).toBeDisabled(),
    );
  });

  test("AC-009: 読み直しで抜けた行が消えると、残った行の「抜ける」と「切替」を押せる", () => {
    const left = leftCompanyB();
    const refreshed = update(
      left,
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: latestRefreshNumberOf(left),
          state: stateOf(COMPANY_A.companyId, [COMPANY_A, COMPANY_C]),
          maybeDoneText: Option.some(`「${COMPANY_B.companyName}」から抜けました。`),
        }),
      ),
    ).model;
    scene(
      { update, view },
      givenScene(refreshed),
      expectScene(role("button", { name: "抜ける" })).toBeEnabled(),
      expectScene(role("button", { name: "切替" })).toBeEnabled(),
    );
  });

  test("AC-010: 読み直しが失敗すると、抜けた行の「抜ける」を押せる状態に戻る", () => {
    const left = leftCompanyB();
    const failed = update(
      left,
      currentCompanyMessage(
        CurrentCompany.Message.FailedRefreshCompanyState({
          refreshNumber: latestRefreshNumberOf(left),
          failure: "Unexpected",
          actionText: "事業所から抜けました",
        }),
      ),
    ).model;
    scene(
      { update, view },
      givenScene(failed),
      expectScene(role("button", { name: "抜ける" })).toBeEnabled(),
    );
  });

  test("AC-011: web/src の story か scene の test に、離脱の成功の後に押せないことを見る test がある", () => {
    const blocks = gitFiles(
      ":(glob)web/src/**/*.story.test.ts",
      ":(glob)web/src/**/*.scene.test.ts",
    ).flatMap(testBlocksIn);
    expect(
      blocks.some(
        (block) => block.includes("SucceededLeaveCompany") && block.includes("toBeDisabled"),
      ),
    ).toBe(true);
  });
});

const settingsOpened = () => ready("/account/company-settings");

const savingSettings = (): Model =>
  update(settingsOpened(), companySettingsMessage(CompanySettings.Message.SubmittedCompanyForm()))
    .model;

const selectB = currentCompanyMessage(
  CurrentCompany.Message.SelectedCompany({ companyId: COMPANY_B.companyId }),
);

const hasSwitchCompany = (commands: ReadonlyArray<AnyCommand>) =>
  commands.some((command) => command.name === CurrentCompany.SwitchCompany.name);

type CompanyDeletionMessage = Parameters<
  typeof CompanySettings.Message.GotCompanyDeletionMessage
>[0]["message"];

const deletionMessage = (message: CompanyDeletionMessage) =>
  companySettingsMessage(CompanySettings.Message.GotCompanyDeletionMessage({ message }));

const finishSwitchIfSent = (model: Model, commands: ReadonlyArray<AnyCommand>): Model => {
  if (!hasSwitchCompany(commands)) {
    return model;
  }
  const switched = update(
    model,
    currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
  );
  return update(
    switched.model,
    currentCompanyMessage(
      CurrentCompany.Message.SucceededRefreshCompanyState({
        refreshNumber: latestRefreshNumberOf(switched.model),
        state: stateOf(COMPANY_B.companyId, [COMPANY_A, COMPANY_B]),
        maybeDoneText: Option.none(),
      }),
    ),
  ).model;
};

const resolveRefresh = (model: Model, commands: ReadonlyArray<AnyCommand>): Model => {
  const refresh = commands.find(
    (command) => command.name === CurrentCompany.RefreshCompanyState.name,
  );
  if (refresh === undefined) {
    return model;
  }
  const args = refresh.args as {
    refreshNumber: number;
    texts: { maybeDoneText: Option.Option<string> };
  };
  return update(
    model,
    currentCompanyMessage(
      CurrentCompany.Message.SucceededRefreshCompanyState({
        refreshNumber: args.refreshNumber,
        state: currentStateOf(model) ?? stateOf(COMPANY_A.companyId, [COMPANY_A, COMPANY_B]),
        maybeDoneText: args.texts.maybeDoneText,
      }),
    ),
  ).model;
};

describe("事業所の設定の送信中の切り替え", () => {
  test("AC-012: 保存の送信中に枠の select で別の事業所を選んでも、切り替えを送らない", () => {
    expect(hasSwitchCompany(commandsOf(update(savingSettings(), selectB)))).toBe(false);
  });

  test("AC-013: 削除の送信中に枠の select で別の事業所を選んでも、切り替えを送らない", () => {
    const deleting = [
      deletionMessage({ _tag: "ClickedDeleteCompany" }),
      deletionMessage({ _tag: "ClickedConfirmDeletion", companyName: COMPANY_A.companyName }),
    ].reduce((current, each) => update(current, each).model, settingsOpened());
    expect(hasSwitchCompany(commandsOf(update(deleting, selectB)))).toBe(false);
  });

  test("AC-014: 保存の送信中は、枠の「事業所を切り替え」の select を選べない", () => {
    scene(
      { update, view },
      givenScene(savingSettings()),
      expectScene(role("combobox", { name: "事業所を切り替え" })).toBeDisabled(),
    );
  });

  test("AC-015: 保存の送信中に別の事業所を選んでも、保存の成功が届けば完了を通知する", () => {
    const saving = savingSettings();
    const visit = pageVisitOf(saving);
    const selected = update(saving, selectB);
    const afterSwitch = finishSwitchIfSent(selected.model, commandsOf(selected));
    const saved = update(
      afterSwitch,
      companySettingsMessage(CompanySettings.Message.SucceededUpdateCompany({ visit })),
    );
    const refreshed = resolveRefresh(saved.model, commandsOf(saved));
    expect(refreshed.toast.entries.map((entry) => entry.payload.text)).toContain(
      "事業所情報を更新しました。",
    );
  });

  test("AC-016: 保存の成功が届いた後は、枠の select で別の事業所を選ぶと切り替えを送る", () => {
    const saving = savingSettings();
    const saved = update(
      saving,
      companySettingsMessage(
        CompanySettings.Message.SucceededUpdateCompany({ visit: pageVisitOf(saving) }),
      ),
    );
    const refreshed = resolveRefresh(saved.model, commandsOf(saved));
    expect(hasSwitchCompany(commandsOf(update(refreshed, selectB)))).toBe(true);
  });

  test("AC-017: web/src の story か scene の test に、送信中に事業所を選ぶ test がある", () => {
    const blocks = gitFiles(
      ":(glob)web/src/**/*.story.test.ts",
      ":(glob)web/src/**/*.scene.test.ts",
    ).flatMap(testBlocksIn);
    expect(
      blocks.some(
        (block) =>
          (block.includes("SubmittedCompanyForm") || block.includes("ClickedConfirmDeletion")) &&
          block.includes("SelectedCompany"),
      ),
    ).toBe(true);
  });
});

const FIXTURE_SUFFIX = `acceptance-fixture-${process.pid}`;

const FIXTURES = {
  invitationToMfa: {
    path: `web/src/invitation/${FIXTURE_SUFFIX}.ts`,
    source: 'import { MFA_CODE_TEXTS } from "../mfa/mfa-code";\nexport type Fixture = typeof MFA_CODE_TEXTS;\n',
  },
  companyToAccountPage: {
    path: `web/src/company/${FIXTURE_SUFFIX}.ts`,
    source:
      'import { Model } from "../account/pages/Profile";\nexport type Fixture = typeof Model;\n',
  },
  sharedToAuth: {
    path: `web/src/shared/${FIXTURE_SUFFIX}.ts`,
    source:
      'import { readSignedInUserId } from "../auth/sign-in-client";\nexport type Fixture = typeof readSignedInUserId;\n',
  },
  authToAccount: {
    path: `web/src/auth/${FIXTURE_SUFFIX}.ts`,
    source:
      'import { Membership } from "../account/current-company";\nexport type Fixture = typeof Membership;\n',
  },
} as const;

const typecheck = () => {
  const result = run("bun", ["run", "typecheck"]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("web の domain の境界の型", () => {
  let withViolations: { status: number | null; output: string } = { status: null, output: "" };

  beforeAll(() => {
    try {
      for (const fixture of Object.values(FIXTURES)) {
        writeFileSync(join(REPO_ROOT, fixture.path), fixture.source);
      }
      withViolations = typecheck();
    } finally {
      for (const fixture of Object.values(FIXTURES)) {
        rmSync(join(REPO_ROOT, fixture.path), { force: true });
      }
    }
  }, 120_000);

  afterAll(() => {
    for (const fixture of Object.values(FIXTURES)) {
      rmSync(join(REPO_ROOT, fixture.path), { force: true });
    }
  });

  const errorLinesFor = (path: string) =>
    withViolations.output.split("\n").filter((line) => line.includes(path.replace(/^web\//, "")));

  test("AC-018: invitation から mfa の file を import すると、typecheck が TS6307 で落ちる", () => {
    expect(withViolations.status).not.toBe(0);
    expect(errorLinesFor(FIXTURES.invitationToMfa.path).some((line) => line.includes("TS6307"))).toBe(
      true,
    );
  });

  test("AC-019: company の直下から account の page を import すると、typecheck が落ちる", () => {
    expect(withViolations.status).not.toBe(0);
    expect(errorLinesFor(FIXTURES.companyToAccountPage.path).length).toBeGreaterThan(0);
  });

  test("AC-020: shared から auth の file を import すると、typecheck が落ちる", () => {
    expect(withViolations.status).not.toBe(0);
    expect(errorLinesFor(FIXTURES.sharedToAuth.path).length).toBeGreaterThan(0);
  });

  test("AC-021: auth から account の file を import して domain が循環すると、typecheck が落ちる", () => {
    expect(withViolations.status).not.toBe(0);
    expect(errorLinesFor(FIXTURES.authToAccount.path).length).toBeGreaterThan(0);
  });

  test("AC-022: 違反の file を置かない tree では、typecheck が通る", () => {
    expect(typecheck().status).toBe(0);
  }, 120_000);

  test("AC-023: src/__tests__ に、型で守るようになった domain の境界の走査が無い", () => {
    expect(
      gitGrep(
        "cross-domain path not allowed|domain page import is app-only|shared reverse dependency|domain dependency cycle|ALLOWED_CROSS_DOMAIN",
        "src/__tests__",
      ),
    ).toEqual([]);
  });

  test("AC-024: ADR-0015 が、domain の境界を守る仕組みとして project references を名指しする", () => {
    expect(
      readFileSync(
        join(REPO_ROOT, "docs/adr/0015-web-domain-first-directory-structure.md"),
        "utf8",
      ),
    ).toMatch(/project references|TS6307/);
  });
});
