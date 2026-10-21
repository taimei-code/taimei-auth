import { expect, test } from "bun:test";
import { deleteCompany } from "../../company/delete";
import { updateCompanyInfo } from "../../company/update";
import { acceptInvitation } from "../../invitation/accept";
import { createInvitation } from "../../invitation/create";
import { pendingInvitationsOf } from "../../invitation/pending-invitations";
import { revokeInvitation } from "../../invitation/revoke";
import { changeRole } from "../change-role";
import { requireMembershipOf, type VerifiedMember } from "../guard";
import { switchCurrentCompany } from "../current-company";
import { listMembers } from "../list-members";
import { removeMember } from "../remove";
import { transferOwnership } from "../transfer-ownership";

const actor = { id: "u1", email: "u1@example.com", lastUsedCompanyId: null };
const input = { name: "Acme", orgCode: "CORPORATE" as const };

const _plainValuesAreRejected = () => {
  const member = { actor, companyId: "c1", role: "OWNER" as const };
  // @ts-expect-error guard を通らない値では事業所を更新できない
  const _call1 = updateCompanyInfo(member, input);
  // @ts-expect-error guard を通らない値では事業所を削除できない
  const _call2 = deleteCompany(member);
  // @ts-expect-error guard を通らない値では招待を作れない
  const _call3 = createInvitation({
    actor,
    companyId: "c1",
    email: "x@example.com",
    role: "MEMBER",
    redirectTarget: undefined,
  });
  // @ts-expect-error guard を通らない値では招待を取り消せない
  const _call4 = revokeInvitation(member, "inv1");
  // @ts-expect-error guard を通らない値では role を変えられない
  const _call5 = changeRole({
    actor,
    companyId: "c1",
    targetUserId: "t",
    targetRole: "MEMBER",
    nextRole: "ADMIN",
  });
  // @ts-expect-error guard を通らない値ではメンバーを削除できない
  const _call6 = removeMember({
    actor,
    companyId: "c1",
    targetUserId: "t",
    targetRole: "MEMBER",
  });
  // @ts-expect-error guard を通らない値では OWNER を委譲できない
  const _call7 = transferOwnership({ actor, companyId: "c1", toUserId: "t" });
  // @ts-expect-error guard を通らない値では招待を受諾できない
  const _call8 = acceptInvitation({ mode: "proceed", actor, invitation: {} as never });
  // @ts-expect-error guard を通らない値ではメンバーの一覧を読めない
  const _call9 = listMembers(member);
  // @ts-expect-error guard を通らない値では未対応の招待の一覧を読めない
  const _call10 = pendingInvitationsOf(member);
};

const _weakerRoleIsRejected = (admin: VerifiedMember<"ADMIN">) => {
  // @ts-expect-error 事業所の更新は OWNER の値だけを受ける
  const _call11 = updateCompanyInfo(admin, input);
  // @ts-expect-error 事業所の削除は OWNER の値だけを受ける
  const _call12 = deleteCompany(admin);
  // @ts-expect-error guard の値を spread して role を書き換えても、OWNER の値にはならない
  const _call16 = deleteCompany({ ...admin, role: "OWNER" as const });
};

const _roleIsCheckedAtRuntime = () =>
  // @ts-expect-error 閾値を型の引数だけで渡すと実行時に確かめないので、minRole を省けない
  requireMembershipOf<"OWNER">(actor, "c1");

const _strongerRoleIsAccepted = (owner: VerifiedMember<"OWNER">) => {
  const _call13 = revokeInvitation(owner, "inv1");
  const _call14 = pendingInvitationsOf(owner);
  const _call15 = listMembers(owner);
};

const _switchReadsTheCurrentCompanyItself = () =>
  switchCurrentCompany({
    userId: "u1",
    companyId: "c2",
    // @ts-expect-error 直前の事業所は切り替えの transaction の中で読むので、呼び手は渡せない
    fromCompanyId: "c1",
  });

test("use-case と読み出しは guard が返した値だけを受け、必要な role より弱い値を受けない (typecheck で検査する)", () => {
  expect(true).toBe(true);
});
