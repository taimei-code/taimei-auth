import {
  deleteAuditByUserIds,
  deleteCompaniesByNames,
  deleteInvitationByToken,
  deleteUsersByIds,
} from "@/db/testing/cleanup";
import {
  readCompanyIdsByName,
  readUser,
  readUserIdsByEmailPrefix,
  readUserIdsByEmails,
} from "@/db/testing/read";
import { createSeed, ids, type SeedInvitationOptions } from "@/db/testing/seed";

type Role = SeedInvitationOptions["role"];

// e2e spec が前提にする固定ユーザー・事業所 (fixture) の作成・削除を担う唯一のモジュール。
// DB 接触の例外 path は db/CLAUDE.md の「例外 path (正本)」のとおり fixture 再生成に限り、実体は db/testing/* (Promise) を使う。
// DB 接触を spec プロセスへ持ち込ませないため、spec は helpers.ts の reseedFixture (子プロセス) 経由で e2e/seed.ts を呼ぶ。

// 破壊的 cleanup を伴う全操作の前提条件: 接続先がローカル DB であること。
// 判定材料は APP_ENV でなく DATABASE_URL — 想定する操作ミス「本番 DATABASE_URL を export
// したまま手動実行」では APP_ENV が未設定のままで、env 派生の判定は素通しする (fail-open)。
// Bun/Node 経路では接続先を決めるのは DATABASE_URL そのもの (Workers は Hyperdrive binding
// だが seed は Bun 限定)。allowlist 外・未設定・parse 不能は理由を出して即終了 (fail-closed)。
// SSH トンネル等で本番 DB を localhost に露出させた状態までは判別できない。
// IPv6 loopback は URL.hostname が角括弧付き "[::1]" を返すため、その表記で列挙する。
const LOCAL_DB_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "auth-postgres"]);

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL;
  const hostname = url && URL.canParse(url) ? new URL(url).hostname : null;
  if (hostname === null || !LOCAL_DB_HOSTNAMES.has(hostname)) {
    console.error(
      `[e2e-seed] abort: DATABASE_URL の host "${hostname ?? "(unset or unparsable)"}" はローカル DB (${[...LOCAL_DB_HOSTNAMES].join(" / ")}) ではない。e2e seed は e2e- prefix の user / company を削除するため実行しない`,
    );
    process.exit(1);
  }
}

// fixture の識別子は db/testing/seed.ts の ids(prefix) から導出する。seed と cleanup が同じ導出を
// 共有することで、リテラルの手写しずれ (typo した側だけ削除が 0 件になり、次 run の duplicate key
// として別の場所で落ちる) を構造的に防ぐ。
const E2E_PREFIX = "e2e-";
const fixtureIds = ids(E2E_PREFIX);
const seed = createSeed(E2E_PREFIX);
const fixtureEmail = fixtureIds.email;
const seededUserId = fixtureIds.userId;
const fixtureCompanyName = fixtureIds.companyName;

const seedUser = (suffix: string, name: string): Promise<string> =>
  seed.seedUser(suffix, { name }).then((u) => u.id);

const seedCompany = (suffix: string): Promise<string> => seed.seedCompany(suffix);

const seedMembership = (userId: string, companyId: string, role: Role): Promise<void> =>
  seed.seedMembership(userId, companyId, role).then(() => undefined);

// 自 fixture の行だけを消して冪等な作り直しを可能にする (user.email は unique、company.name は
// 非 unique のため、削除なしの再実行は duplicate key / 同名 company の重複になる)。
// - email 検索: sign-up flow が作る user は id がランダムで、固定 id では回収できない
// - 固定 id: アカウント連動削除で user 行が消えた後も audit_log (user FK なし) が残る
// - FK: user 削除で session / membership / invitation は cascade、company は membership が
//   restrict のため user → company の順で消す
async function removeFixtureRows(rows: {
  userSuffixes: string[];
  companySuffixes?: string[];
}): Promise<void> {
  const existing = await readUserIdsByEmails(rows.userSuffixes.map(fixtureEmail));
  const userIds = [...new Set([...existing, ...rows.userSuffixes.map(seededUserId)])];
  await deleteAuditByUserIds(userIds);
  await deleteUsersByIds(userIds);
  if (rows.companySuffixes !== undefined) {
    await deleteCompaniesByNames(rows.companySuffixes.map(fixtureCompanyName));
  }
}

type FixtureSpec = {
  company: string;
  members: { suffix: string; name: string; role: Role }[];
};

async function ensureFixture(spec: FixtureSpec): Promise<void> {
  assertLocalDatabase();
  await removeFixtureRows({
    userSuffixes: spec.members.map((m) => m.suffix),
    companySuffixes: [spec.company],
  });
  const companyId = await seedCompany(spec.company);
  for (const m of spec.members) {
    await seedMembership(await seedUser(m.suffix, m.name), companyId, m.role);
  }
}

// sign-in flow + members 画面用 (再利用型 = spec が読むだけで消費しない fixture): OWNER /
// ADMIN / MEMBER が同居する事業所。
// main は実行中にメンバー構成が変わる (invitation-flow が invitee を MEMBER として追加する)
// ため、spec は main に対する件数 assertion を書かないこと。main を消費 (アカウント削除等で
// 破壊) する spec も追加しないこと — 招待 fixture の再生成が main の実在を前提にしている。
// 再作成は resetAllFixtures (全体 seed) 限定 — 招待 fixture が main を FK 参照しており、
// 実行中の作り直しは cascade で招待行を道連れにする。
const MAIN_FIXTURE: FixtureSpec = {
  company: "main",
  members: [
    { suffix: "signin", name: "E2E SignIn", role: "OWNER" },
    { suffix: "member", name: "E2E Member", role: "MEMBER" },
    { suffix: "admin", name: "E2E Admin", role: "ADMIN" },
  ],
};

// company-leave flow 用 (消費型 = spec 実行がアカウントごと消費する fixture): OWNER が
// 別にいる事業所だけに所属する MEMBER
// (最後の所属から抜けると orphan としてアカウント連動削除される状態)。
// leave は事業所のメンバー構成を実行中に変えるため、他 spec が共有する main には
// 置かず専用事業所に隔離する (danger / delete と同じ規約)。
const LEAVE_FIXTURE: FixtureSpec = {
  company: "leave",
  members: [
    { suffix: "leave-owner", name: "E2E LeaveOwner", role: "OWNER" },
    { suffix: "leaver", name: "E2E Leaver", role: "MEMBER" },
  ],
};

// danger-zone 用 (再利用型): 唯一の OWNER (退会が PRECONDITION_FAILED で弾かれる状態)。
const DANGER_FIXTURE: FixtureSpec = {
  company: "danger",
  members: [{ suffix: "danger", name: "E2E Danger", role: "OWNER" }],
};

// company-delete flow 用 (消費型): 唯一 OWNER + 単一事業所 (最後の事業所削除でアカウント
// 連動削除される状態)。
const DELETE_FIXTURE: FixtureSpec = {
  company: "delete",
  members: [{ suffix: "delete", name: "E2E Delete", role: "OWNER" }],
};

// company-delete flow 用 (消費型): 2 事業所の OWNER を兼ねる 1 user。片方を削除しても所属が残る
// ため、アカウント連動削除でなく所属事業所一覧への遷移で終わる。1 fixture = 1 事業所の
// FixtureSpec では 1 user の複数所属を表現できないため個別に組む。
// current 側を last_used_company_id で固定するのは、未設定だと handler が membership の先頭
// (SQL の行順は不定) へフォールバックし、spec 側でどちらが削除対象か決まらないため。
const DELETE_MULTI_USER = "delete-multi";
const DELETE_MULTI_CURRENT_COMPANY = "delete-multi-current";
const DELETE_MULTI_OTHER_COMPANY = "delete-multi-other";

async function ensureDeleteMultiFixture(): Promise<void> {
  assertLocalDatabase();
  await removeFixtureRows({
    userSuffixes: [DELETE_MULTI_USER],
    companySuffixes: [DELETE_MULTI_CURRENT_COMPANY, DELETE_MULTI_OTHER_COMPANY],
  });
  const userId = await seedUser(DELETE_MULTI_USER, "E2E DeleteMulti");
  const currentCompanyId = await seedCompany(DELETE_MULTI_CURRENT_COMPANY);
  await seedMembership(userId, currentCompanyId, "OWNER");
  await seedMembership(userId, await seedCompany(DELETE_MULTI_OTHER_COMPANY), "OWNER");
  await seed.setLastUsedCompany(userId, currentCompanyId);
}

// mfa-flow 用 (消費型): 単一 OWNER。認証アプリの secret は server が enroll 時に生成し事前 seed
// できないため、fixture は「MFA 未設定の user」までを用意し、有効化は spec が実行中に行う。
// test ごとに作り直すのは、有効化済みの user を次の test が掴むと enroll が 409 で落ちるため
// (main に置かず専用事業所へ隔離するのは leave / delete と同じ規約)。
const MFA_FIXTURE: FixtureSpec = {
  company: "mfa",
  members: [{ suffix: "mfa", name: "E2E Mfa", role: "OWNER" }],
};

// invitation-flow 用 (消費型): e2e-invitee 宛の PENDING 招待。受諾すると招待行は ACCEPTED に
// 落ち、invitee は signup で main のメンバーになるため、作り直しは invitee ユーザーの削除
// (membership も cascade で消える) と PENDING 行の再作成の両方を含む。
const INVITATION_TOKEN = "e2e-invitation-token";

async function ensureInvitationFixture(): Promise<void> {
  assertLocalDatabase();
  // main の検証は破壊 (invitee / 招待行の削除) より先 — 不整合時に消すだけ消して abort しない
  const main = await findTheMainCompany();
  await removeFixtureRows({ userSuffixes: ["invitee"] });
  await deleteInvitationByToken(INVITATION_TOKEN);
  await seed.seedInvitation({
    companyId: main.companyId,
    email: fixtureEmail("invitee"),
    role: "MEMBER",
    token: INVITATION_TOKEN,
    invitedByUserId: main.invitedByUserId,
  });
}

// 招待 fixture だけが持つ fixture 間依存の解決: 招待行は main の company id (ランダム生成で
// run をまたいで固定できない) と招待者 user を FK 参照する。company.name は unique でないため
// 「ちょうど 1 行」でなければ即 fail する — 2 件ヒットをどちらか silent に掴むと招待が誤った
// 事業所へ入り、spec が無関係な文言で落ちる (本 fixture 分離が消したい症状そのもの)。
async function findTheMainCompany(): Promise<{ companyId: string; invitedByUserId: string }> {
  const [companies, inviter] = await Promise.all([
    readCompanyIdsByName(fixtureCompanyName("main")),
    readUser(seededUserId("signin")),
  ]);
  if (companies.length !== 1 || !inviter) {
    console.error(
      `[e2e-seed] abort: main fixture が不整合 (e2e-co-main: ${companies.length} 件 / e2e-u-signin: ${inviter ? 1 : 0} 件)。全体 seed (bun run e2e/seed.ts) を先に実行すること`,
    );
    process.exit(1);
  }
  return { companyId: companies[0], invitedByUserId: inviter.id };
}

// 消費型 fixture (spec 実行が消費する) の registry — 単一 fixture 再生成で指定できる名前の正本。
// 再利用型 (main / danger) は載せない: 招待 fixture が main を FK 参照しており、実行中の
// main 再作成は cascade で招待行を道連れにするため (再作成は entrypoint の全体 seed 限定)。
export const consumableFixtures = new Map<string, () => Promise<void>>([
  ["leave", () => ensureFixture(LEAVE_FIXTURE)],
  ["delete", () => ensureFixture(DELETE_FIXTURE)],
  ["delete-multi", ensureDeleteMultiFixture],
  ["invitation", ensureInvitationFixture],
  ["mfa", () => ensureFixture(MFA_FIXTURE)],
]);

// e2e- prefix の全 fixture を冪等に作り直す (サーバ起動前の全体 seed 専用)。
// グローバル cleanup をここ限定にするのは、e2e-% が auth-flow の e2e-newbie-* (spec 実行中に
// 作られる使い捨てユーザー) にも一致し、spec から呼べる形にすると実行中の他 fixture を
// 巻き込むため。
export async function resetAllFixtures(): Promise<void> {
  assertLocalDatabase();
  const staleIds = await readUserIdsByEmailPrefix(E2E_PREFIX);
  await deleteAuditByUserIds(staleIds);
  await deleteUsersByIds(staleIds);
  // アカウント連動削除で消えた seed user は user 行が残らず staleIds に入らないため、
  // その audit だけ固定 id prefix で回収する。company も prefix で回収する
  await seed.cleanup();

  // 生成順は依存順: invitation が main の company / user を FK 参照する
  await ensureFixture(MAIN_FIXTURE);
  await ensureFixture(LEAVE_FIXTURE);
  await ensureFixture(DANGER_FIXTURE);
  await ensureFixture(DELETE_FIXTURE);
  await ensureDeleteMultiFixture();
  await ensureFixture(MFA_FIXTURE);
  await ensureInvitationFixture();
}
