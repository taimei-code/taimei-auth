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

// e2e spec が前提にする固定ユーザーと事業所 (fixture) の作成と削除を担う唯一のモジュール。
// DB に直接触れる例外は db/CLAUDE.md の「例外 path (正本)」のとおり fixture の再生成に限り、実体は db/testing/* (Promise) を使う。
// DB への接続を spec のプロセスへ持ち込ませないため、spec は helpers.ts の reseedFixture (子プロセス) 経由で e2e/seed.ts を呼ぶ。

// 破壊的な cleanup を伴うすべての操作は、接続先がローカル DB であることを前提にする。
// 判定材料は APP_ENV ではなく DATABASE_URL である。想定する操作ミスである「本番の DATABASE_URL を export
// したまま手動実行する」場合、APP_ENV は未設定のままなので、env から導く判定では通してしまう (fail-open になる)。
// Bun と Node の経路では接続先を決めるのは DATABASE_URL そのものである (Workers は Hyperdrive binding
// だが seed は Bun でしか動かさない)。allowlist 外、未設定、parse 不能の場合は理由を出して即終了する (fail-closed)。
// SSH トンネルなどで本番 DB を localhost に露出させた状態までは判別できない。
// IPv6 の loopback は URL.hostname が角括弧付きの "[::1]" を返すため、その表記で列挙する。
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

// fixture の識別子は db/testing/seed.ts の ids(prefix) から導く。seed と cleanup が同じ導き方を
// 共有することで、リテラルを手で書き写した時のずれ (typo した側だけ削除が 0 件になり、次の実行で duplicate key
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

// 自分の fixture の行だけを消して、冪等に作り直せるようにする (user.email は unique、company.name は
// unique ではないため、削除せずに再実行すると duplicate key になるか同名の company が重複する)。
// - email で検索する理由: sign-up flow が作る user は id がランダムで、固定 id では回収できない
// - 固定 id でも検索する理由: アカウント連動削除で user 行が消えた後も audit_log (user への FK が無い) が残る
// - FK の都合: user を削除すると session、membership、invitation は cascade で消えるが、company は membership が
//   restrict のため、user を消してから company を消す
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

// sign-in flow と members 画面のための fixture (再利用型、つまり spec が読むだけで消費しない fixture)。OWNER、
// ADMIN、MEMBER が同居する事業所である。
// main は実行中にメンバー構成が変わる (invitation-flow が invitee を MEMBER として追加する)
// ため、spec は main に対する件数の assertion を書かない。main を消費する (アカウント削除などで
// 壊す) spec も追加しない。招待 fixture の再生成が main の実在を前提にしているためである。
// 作り直しは resetAllFixtures (全体 seed) に限る。招待 fixture が main を FK で参照しており、
// 実行中に作り直すと cascade で招待行も消えてしまう。
const MAIN_FIXTURE: FixtureSpec = {
  company: "main",
  members: [
    { suffix: "signin", name: "E2E SignIn", role: "OWNER" },
    { suffix: "member", name: "E2E Member", role: "MEMBER" },
    { suffix: "admin", name: "E2E Admin", role: "ADMIN" },
  ],
};

// company-leave flow のための fixture (消費型、つまり spec の実行がアカウントごと消費する fixture)。OWNER が
// 別にいる事業所だけに所属する MEMBER である
// (最後の所属から抜けると、所属の無い user としてアカウントも連動して削除される状態)。
// leave は事業所のメンバー構成を実行中に変えるため、他の spec が共有する main には
// 置かず、専用の事業所に隔離する (danger と delete と同じ規約)。
const LEAVE_FIXTURE: FixtureSpec = {
  company: "leave",
  members: [
    { suffix: "leave-owner", name: "E2E LeaveOwner", role: "OWNER" },
    { suffix: "leaver", name: "E2E Leaver", role: "MEMBER" },
  ],
};

// danger-zone のための fixture (再利用型)。唯一の OWNER で、退会が PRECONDITION_FAILED で弾かれる状態にある。
const DANGER_FIXTURE: FixtureSpec = {
  company: "danger",
  members: [{ suffix: "danger", name: "E2E Danger", role: "OWNER" }],
};

// company-delete flow のための fixture (消費型)。唯一の OWNER が単一の事業所に所属し、最後の事業所を削除するとアカウントも
// 連動して削除される状態にある。
const DELETE_FIXTURE: FixtureSpec = {
  company: "delete",
  members: [{ suffix: "delete", name: "E2E Delete", role: "OWNER" }],
};

// company-delete flow のための fixture (消費型)。2 つの事業所の OWNER を兼ねる 1 user である。片方を削除しても所属が残る
// ため、アカウントの連動削除ではなく所属事業所一覧への遷移で終わる。1 fixture に 1 事業所という
// FixtureSpec では 1 user の複数所属を表現できないため、個別に組み立てる。
// current 側を last_used_company_id で固定するのは、未設定だと handler が membership の先頭
// (SQL の行順は不定) へフォールバックし、spec 側でどちらが削除対象か決まらないためである。
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

// mfa-flow のための fixture (消費型)。単一の OWNER である。認証アプリの secret は server が enroll 時に生成し、事前に seed
// できないため、fixture は「MFA 未設定の user」までを用意し、有効化は spec が実行中に行う。
// テストごとに作り直すのは、有効化済みの user を次のテストが使うと enroll が 409 で落ちるためである
// (main に置かず専用の事業所へ隔離するのは leave と delete と同じ規約)。
const MFA_FIXTURE: FixtureSpec = {
  company: "mfa",
  members: [{ suffix: "mfa", name: "E2E Mfa", role: "OWNER" }],
};

// invitation-flow のための fixture (消費型)。e2e-invitee 宛の PENDING の招待である。受諾すると招待行は ACCEPTED に
// 変わり、invitee は signup で main のメンバーになるため、作り直しは invitee ユーザーの削除
// (membership も cascade で消える) と PENDING 行の再作成の両方を含む。
const INVITATION_TOKEN = "e2e-invitation-token";

async function ensureInvitationFixture(): Promise<void> {
  assertLocalDatabase();
  // main の検証は破壊 (invitee と招待行の削除) より先に行う。不整合の時に、消すだけ消してから abort することを避ける
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

// 招待 fixture だけが持つ、fixture 間の依存を解決する。招待行は main の company id (ランダムに生成されるため
// 実行をまたいで固定できない) と招待者の user を FK で参照する。company.name は unique ではないため、
// 「ちょうど 1 行」でなければ即座に失敗させる。2 件ヒットした時にどちらかを気付かれないまま使うと招待が誤った
// 事業所へ入り、spec が無関係な文言で落ちる (この fixture の分離が無くしたい症状そのものである)。
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

// 消費型 fixture (spec の実行が消費する) の一覧。単一 fixture の再生成で指定できる名前はここで定義する。
// 再利用型 (main と danger) は含めない。招待 fixture が main を FK で参照しており、実行中に
// main を作り直すと cascade で招待行も消えてしまうためである (作り直しは entrypoint の全体 seed に限る)。
export const consumableFixtures = new Map<string, () => Promise<void>>([
  ["leave", () => ensureFixture(LEAVE_FIXTURE)],
  ["delete", () => ensureFixture(DELETE_FIXTURE)],
  ["delete-multi", ensureDeleteMultiFixture],
  ["invitation", ensureInvitationFixture],
  ["mfa", () => ensureFixture(MFA_FIXTURE)],
]);

// e2e- prefix の全 fixture を冪等に作り直す (サーバ起動前の全体 seed 専用)。
// 全体の cleanup をここに限るのは、e2e-% が auth-flow の e2e-newbie-* (spec の実行中に
// 作られる使い捨てユーザー) にも一致し、spec から呼べる形にすると実行中の他の fixture を
// 巻き込むためである。
export async function resetAllFixtures(): Promise<void> {
  assertLocalDatabase();
  const staleIds = await readUserIdsByEmailPrefix(E2E_PREFIX);
  await deleteAuditByUserIds(staleIds);
  await deleteUsersByIds(staleIds);
  // アカウント連動削除で消えた seed user は user 行が残らず staleIds に入らないため、
  // その audit だけ固定 id の prefix で回収する。company も prefix で回収する
  await seed.cleanup();

  // 生成は依存の順に行う。invitation が main の company と user を FK で参照する
  await ensureFixture(MAIN_FIXTURE);
  await ensureFixture(LEAVE_FIXTURE);
  await ensureFixture(DANGER_FIXTURE);
  await ensureFixture(DELETE_FIXTURE);
  await ensureDeleteMultiFixture();
  await ensureFixture(MFA_FIXTURE);
  await ensureInvitationFixture();
}
