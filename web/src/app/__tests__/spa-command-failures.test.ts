import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";

import { DeleteAccount } from "../../account/account-deletion";
import { SwitchCompany } from "../../account/current-company";
import { AddCompany } from "../../company/add-company";
import { DeleteCompany } from "../../company/company-deletion";
import { LeaveCompany, Message as CompaniesMessage } from "../../company/pages/Companies";
import { CreateCompany, LoadMemberships } from "../../company/pages/SignUpCompany";
import { DisableMfa } from "../../mfa/mfa-disabling";
import { ActivateMfa, EnrollMfa } from "../../mfa/mfa-enrollment";
import {
  LoadInvitations,
  Message as InvitationsMessage,
  RevokeInvitation,
} from "../../invitation/member-invitations";
import {
  LoadCandidates,
  Message as OwnershipTransferMessage,
  TransferOwnership,
} from "../../membership/ownership-transfer";
import {
  ChangeRole,
  LoadMembers,
  Message as MembersMessage,
  RemoveMember,
} from "../../membership/pages/Members";
import { LoadChallengeState, Message as MfaChallengeMessage } from "../../mfa/pages/MfaChallenge";
import { DeletePasskey, Message as PasskeySettingsMessage } from "../../passkey/passkey-settings";
import { replyingSpaHttpClient } from "../../shared/__tests__/replying-spa-http-client";
import { SpaHttpClient } from "../../shared/spa-http-client";

const declaredFailureFrom = (tag: string) => {
  const endpoint = () => Effect.fail({ _tag: tag });
  const group = new Proxy({}, { get: () => endpoint });
  return Layer.succeed(
    SpaHttpClient,
    new Proxy({}, { get: () => group }) as unknown as SpaHttpClient["Service"],
  );
};

const wire = replyingSpaHttpClient();
const { answerWith, failToConnect } = wire;

const VISIT = 1;
const REQUEST_NUMBER = 2;
const LIST_NUMBER = 3;
const COMPANY_ID = "company-1";
const SELF_USER_ID = "user-self";
const MEMBER = {
  userId: "user-1",
  label: "山田",
  email: "yamada@example.com",
  role: "MEMBER",
} as const;
const OPENED = { _tag: "Opened" } as const;
const MEMBERSHIP = {
  companyId: COMPANY_ID,
  companyName: "テスト株式会社",
  orgCode: "CORPORATE",
  role: "MEMBER",
} as const;
const TARGET = { companyId: COMPANY_ID, companyName: "テスト株式会社", selfUserId: SELF_USER_ID };
const CANDIDATE = { userId: "user-2", label: "鈴木" };

const loadMembers = () => LoadMembers({ visit: VISIT, companyId: COMPANY_ID, reload: OPENED });
const changeRole = () =>
  ChangeRole({ visit: VISIT, companyId: COMPANY_ID, member: MEMBER, role: "ADMIN" });
const removeMember = () => RemoveMember({ visit: VISIT, companyId: COMPANY_ID, member: MEMBER });
const loadInvitations = () =>
  LoadInvitations({ visit: VISIT, listNumber: LIST_NUMBER, companyId: COMPANY_ID, reload: OPENED });
const revokeInvitation = () =>
  RevokeInvitation({ visit: VISIT, companyId: COMPANY_ID, invitationId: "invitation-1" });
const loadCandidates = () =>
  LoadCandidates({ visit: VISIT, requestNumber: REQUEST_NUMBER, target: TARGET });
const transferOwnership = () =>
  TransferOwnership({
    visit: VISIT,
    requestNumber: REQUEST_NUMBER,
    companyId: COMPANY_ID,
    candidate: CANDIDATE,
  });
const leaveCompany = () =>
  LeaveCompany({ visit: VISIT, membership: MEMBERSHIP, selfUserId: SELF_USER_ID });
const loadChallengeState = () => LoadChallengeState({ visit: VISIT });
const deletePasskey = () =>
  DeletePasskey({ visit: VISIT, requestNumber: REQUEST_NUMBER, passkeyId: "passkey-1" });

type RunnableCommand = { readonly effect: Effect.Effect<unknown, never, SpaHttpClient> };

const REQUEST = { visit: VISIT, requestNumber: REQUEST_NUMBER };
const enrollMfa = () => EnrollMfa(REQUEST);
const activateMfa = () => ActivateMfa({ ...REQUEST, code: "123456", enrollmentId: "enrollment-1" });
const disableMfa = () => DisableMfa({ ...REQUEST, code: "123456", kind: "totp" });
const deleteAccount = () => DeleteAccount({ visit: VISIT });
const deleteCompany = () =>
  DeleteCompany({ visit: VISIT, companyId: COMPANY_ID, companyName: "テスト株式会社" });
const addCompany = () => AddCompany({ ...REQUEST, name: "テスト株式会社", orgCode: "CORPORATE" });
const createCompany = () =>
  CreateCompany({ visit: VISIT, name: "テスト株式会社", orgCode: "CORPORATE" });
const loadMemberships = () => LoadMemberships({ visit: VISIT });
const switchCompany = () => SwitchCompany({ companyId: COMPANY_ID });

const MAPPINGS_OF_OTHER_COMMANDS: ReadonlyArray<
  readonly [string, () => RunnableCommand, Readonly<Record<string, string>>]
> = [
  [
    "MFA の登録",
    enrollMfa,
    {
      AlreadyEnabled: "AlreadyEnabled",
      ChallengeExpired: "ChallengeExpired",
      RateLimited: "RateLimited",
      Unauthorized: "Unauthorized",
    },
  ],
  [
    "MFA の有効化",
    activateMfa,
    {
      InvalidCode: "InvalidCode",
      Locked: "Locked",
      EnrollmentChanged: "EnrollmentChanged",
      AlreadyEnabled: "AlreadyEnabled",
      MfaNotFound: "MfaNotFound",
      RateLimited: "RateLimited",
      Unauthorized: "Unauthorized",
    },
  ],
  [
    "MFA の無効化",
    disableMfa,
    {
      InvalidCode: "InvalidCode",
      Locked: "Locked",
      NotEnabled: "NotEnabled",
      RateLimited: "RateLimited",
      Unauthorized: "Unauthorized",
    },
  ],
  [
    "アカウントの削除",
    deleteAccount,
    { LastOwner: "LastOwner", NotFound: "NotFound", Unauthorized: "Unauthorized" },
  ],
  [
    "事業所の削除",
    deleteCompany,
    { Forbidden: "Forbidden", LastOwner: "LastOwner", Unauthorized: "Unauthorized" },
  ],
  ["事業所の追加", addCompany, { Unauthorized: "Unauthorized" }],
  [
    "最初の事業所の作成",
    createCompany,
    { AlreadyExists: "AlreadyExists", Unauthorized: "Unauthorized" },
  ],
  ["所属の一覧の取得", loadMemberships, { Unauthorized: "Unauthorized" }],
  [
    "現在の事業所の切り替え",
    switchCompany,
    { Forbidden: "Forbidden", Unauthorized: "Unauthorized" },
  ],
];

const runWith = <A>(command: { readonly effect: Effect.Effect<A, never, SpaHttpClient> }) => ({
  declaredFailure: (tag: string) =>
    Effect.runPromise(command.effect.pipe(Effect.provide(declaredFailureFrom(tag)))),
  overTheWire: () => Effect.runPromise(command.effect.pipe(Effect.provide(wire.layer))),
});

describe("画面を持つ Command は、契約が宣言した失敗を、画面が見分ける失敗か想定外の失敗に写す", () => {
  test("メンバー一覧の取得が Unauthorized の失敗を受けると、ログインし直す失敗になる", async () => {
    expect(await runWith(loadMembers()).declaredFailure("Unauthorized")).toEqual(
      MembersMessage.FailedLoadMembers({
        visit: VISIT,
        failure: "Unauthorized",
        reload: OPENED,
      }),
    );
  });

  test("メンバー一覧の取得が Forbidden の失敗を受けると、想定外の失敗になる", async () => {
    expect(await runWith(loadMembers()).declaredFailure("Forbidden")).toEqual(
      MembersMessage.FailedLoadMembers({ visit: VISIT, failure: "Unexpected", reload: OPENED }),
    );
  });

  test("招待の一覧の取得が Forbidden の失敗を受けると、想定外の失敗になる", async () => {
    expect(await runWith(loadInvitations()).declaredFailure("Forbidden")).toEqual(
      InvitationsMessage.FailedLoadInvitations({
        visit: VISIT,
        listNumber: LIST_NUMBER,
        failure: "Unexpected",
        reload: OPENED,
      }),
    );
  });

  test("オーナー委譲の候補の取得が Forbidden の失敗を受けると、想定外の失敗になる", async () => {
    expect(await runWith(loadCandidates()).declaredFailure("Forbidden")).toEqual(
      OwnershipTransferMessage.FailedLoadCandidates({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "Unexpected",
      }),
    );
  });

  test("オーナー委譲の候補の取得が Unauthorized の失敗を受けると、ログインし直す失敗になる", async () => {
    expect(await runWith(loadCandidates()).declaredFailure("Unauthorized")).toEqual(
      OwnershipTransferMessage.FailedLoadCandidates({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "Unauthorized",
      }),
    );
  });

  for (const tag of ["Forbidden", "NotFound", "InvalidArgument", "AlreadyOwner", "LastOwner"]) {
    test(`オーナー委譲が ${tag} の失敗を受けると、想定外の失敗になる`, async () => {
      expect(await runWith(transferOwnership()).declaredFailure(tag)).toEqual(
        OwnershipTransferMessage.FailedTransferOwnership({
          visit: VISIT,
          requestNumber: REQUEST_NUMBER,
          failure: "Unexpected",
        }),
      );
    });
  }

  test("オーナー委譲が Unauthorized の失敗を受けると、ログインし直す失敗になる", async () => {
    expect(await runWith(transferOwnership()).declaredFailure("Unauthorized")).toEqual(
      OwnershipTransferMessage.FailedTransferOwnership({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "Unauthorized",
      }),
    );
  });

  for (const tag of ["Forbidden", "NotFound", "LastOwner", "Unauthorized"] as const) {
    test(`メンバーの役割の変更が ${tag} の失敗を受けると、同じ名前の失敗になる`, async () => {
      expect(await runWith(changeRole()).declaredFailure(tag)).toEqual(
        MembersMessage.FailedChangeRole({ visit: VISIT, failure: tag }),
      );
    });

    test(`メンバーの削除が ${tag} の失敗を受けると、同じ名前の失敗になる`, async () => {
      expect(await runWith(removeMember()).declaredFailure(tag)).toEqual(
        MembersMessage.FailedRemoveMember({ visit: VISIT, failure: tag }),
      );
    });
  }

  test("招待の取り消しが NotFoundOrNotPending の失敗を受けると、同じ名前の失敗になる", async () => {
    expect(await runWith(revokeInvitation()).declaredFailure("NotFoundOrNotPending")).toEqual(
      InvitationsMessage.FailedRevokeInvitation({ visit: VISIT, failure: "NotFoundOrNotPending" }),
    );
  });

  test("会社からの脱退が LastOwner の失敗を受けると、同じ名前の失敗になる", async () => {
    expect(await runWith(leaveCompany()).declaredFailure("LastOwner")).toEqual(
      CompaniesMessage.FailedLeaveCompany({
        visit: VISIT,
        companyId: COMPANY_ID,
        failure: "LastOwner",
      }),
    );
  });

  for (const tag of ["Forbidden", "NotFound"]) {
    test(`会社からの脱退が ${tag} の失敗を受けると、想定外の失敗になる`, async () => {
      expect(await runWith(leaveCompany()).declaredFailure(tag)).toEqual(
        CompaniesMessage.FailedLeaveCompany({
          visit: VISIT,
          companyId: COMPANY_ID,
          failure: "Unexpected",
        }),
      );
    });
  }

  test("パスキーの削除が NotFound の失敗を受けると、同じ名前の失敗になる", async () => {
    expect(await runWith(deletePasskey()).declaredFailure("NotFound")).toEqual(
      PasskeySettingsMessage.FailedDeletePasskey({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "NotFound",
      }),
    );
  });

  test("MFA の状態の取得は、回数の上限の失敗を受けても、失敗を区別せず 1 つの失敗になる", async () => {
    expect(await runWith(loadChallengeState()).declaredFailure("RateLimited")).toEqual(
      MfaChallengeMessage.FailedLoadChallengeState({ visit: VISIT }),
    );
  });
});

describe("画面を持つ Command は、通信の失敗と応答の形の違反を、想定外の失敗に写す", () => {
  test("メンバー一覧の取得で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(loadMembers()).overTheWire()).toEqual(
      MembersMessage.FailedLoadMembers({ visit: VISIT, failure: "Unexpected", reload: OPENED }),
    );
  });

  test("メンバー一覧の取得の応答が契約の形でないと、想定外の失敗になる", async () => {
    answerWith(200, { unexpected: true });
    expect(await runWith(loadMembers()).overTheWire()).toEqual(
      MembersMessage.FailedLoadMembers({ visit: VISIT, failure: "Unexpected", reload: OPENED }),
    );
  });

  test("メンバーの役割の変更で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(changeRole()).overTheWire()).toEqual(
      MembersMessage.FailedChangeRole({ visit: VISIT, failure: "Unexpected" }),
    );
  });

  test("メンバーの削除で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(removeMember()).overTheWire()).toEqual(
      MembersMessage.FailedRemoveMember({ visit: VISIT, failure: "Unexpected" }),
    );
  });

  test("メンバーの削除の応答が契約の形でないと、想定外の失敗になる", async () => {
    answerWith(200, { unexpected: true });
    expect(await runWith(removeMember()).overTheWire()).toEqual(
      MembersMessage.FailedRemoveMember({ visit: VISIT, failure: "Unexpected" }),
    );
  });

  test("招待の一覧の取得で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(loadInvitations()).overTheWire()).toEqual(
      InvitationsMessage.FailedLoadInvitations({
        visit: VISIT,
        listNumber: LIST_NUMBER,
        failure: "Unexpected",
        reload: OPENED,
      }),
    );
  });

  test("招待の取り消しで通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(revokeInvitation()).overTheWire()).toEqual(
      InvitationsMessage.FailedRevokeInvitation({ visit: VISIT, failure: "Unexpected" }),
    );
  });

  test("オーナー委譲の候補の取得で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(loadCandidates()).overTheWire()).toEqual(
      OwnershipTransferMessage.FailedLoadCandidates({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "Unexpected",
      }),
    );
  });

  test("オーナー委譲で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(transferOwnership()).overTheWire()).toEqual(
      OwnershipTransferMessage.FailedTransferOwnership({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "Unexpected",
      }),
    );
  });

  test("会社からの脱退で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(leaveCompany()).overTheWire()).toEqual(
      CompaniesMessage.FailedLeaveCompany({
        visit: VISIT,
        companyId: COMPANY_ID,
        failure: "Unexpected",
      }),
    );
  });

  test("パスキーの削除で通信が失敗すると、想定外の失敗になる", async () => {
    failToConnect();
    expect(await runWith(deletePasskey()).overTheWire()).toEqual(
      PasskeySettingsMessage.FailedDeletePasskey({
        visit: VISIT,
        requestNumber: REQUEST_NUMBER,
        failure: "Unexpected",
      }),
    );
  });

  test("MFA の状態の取得で通信が失敗すると、失敗を区別せず 1 つの失敗になる", async () => {
    failToConnect();
    expect(await runWith(loadChallengeState()).overTheWire()).toEqual(
      MfaChallengeMessage.FailedLoadChallengeState({ visit: VISIT }),
    );
  });

  test("MFA の状態の取得の応答が契約の形でないと、失敗を区別せず 1 つの失敗になる", async () => {
    answerWith(200, { unexpected: true });
    expect(await runWith(loadChallengeState()).overTheWire()).toEqual(
      MfaChallengeMessage.FailedLoadChallengeState({ visit: VISIT }),
    );
  });
});

describe("ほかの Command も、契約が宣言した失敗を、変える前と同じ失敗に写す", () => {
  for (const [label, command, outcomes] of MAPPINGS_OF_OTHER_COMMANDS) {
    for (const [declared, expected] of Object.entries(outcomes)) {
      test(`${label}が ${declared} の失敗を受けると、${expected} の失敗になる`, async () => {
        expect(await runWith(command()).declaredFailure(declared)).toMatchObject({
          failure: expected,
        });
      });
    }
  }
});
