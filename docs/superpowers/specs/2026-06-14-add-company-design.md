# 既存ユーザーによる事業所の追加作成 — 設計

- 日付: 2026-06-14
- 関連: ADR-009 (事業所 / membership の N:M モデル, `~/.claude/plans/taimei/ADR-009-company-concept.md`)
- ブランチ: `feature/add-company-existing-user`

## 背景 / 課題

ADR-009 で事業所は「1 user が複数事業所に所属する N:M」モデルとして導入された（会計士 / 副業 / グループ会社を想定）。
しかし現状、既存ユーザーが **2 つ目以降の事業所を自分で作る導線が UI にもサーバにも無い**:

- `POST /api/account/companies` は `findMembershipsByUserId` を見て **membership が 1 件でもあれば 409 (`already_exists`)** を返す = サインアップ直後（所属 0 件）の「最初の 1 事業所」専用。フロントで叩くのは `web/src/pages/SignUpCompany.tsx` のみ。
- `web/src/pages/account/Companies.tsx`（所属事業所）は既存事業所の**切り替え / 退会 / オーナー委譲**のみ。追加導線なし。
- 既存ユーザーの所属が増える経路は招待（membership）だけ。自分で新規事業所を起こせない。

N:M モデルの意図（グループ会社などを自分で起こす）に沿って、既存ユーザーの事業所追加作成を可能にする。

## スコープ

### やること
- 既存ユーザー（membership ≥ 1）が新しい事業所を作成し、自動で OWNER になる
- 作成後、現在の事業所をその新事業所に切り替える
- 所属事業所ページからダイアログで作成（事業所名 + 事業形態の 2 項目）

### やらないこと（YAGNI）
- 作成時に他メンバーを同時招待する / 既存事業所の設定をコピーする等の付加機能
- 個人事業主の重複制限（**制限なし**方針 — 法人も個人事業主も自由に複数作れる）
- auth-client SDK の公開 API 変更（内部 account API への additive な追加に閉じる）

## 確定した仕様判断

| 論点 | 決定 |
|---|---|
| UI 配置 | 所属事業所ページ（`Companies.tsx`）にボタン + ダイアログ |
| 作成後の挙動 | 新事業所に切り替える（current = 新事業所） |
| 個人事業主の重複 | 制限なし（法人 / 個人事業主とも複数可） |
| サーバ API の層構造 | use-case 層を新設（`src/company/create.ts`）。handler は HTTP 変換のみ |

## アーキテクチャ

層は HTTP（handler）→ 業務 orchestration（use-case）→ データアクセス（repository）の 3 段。
use-case 層は `src/invitation/` と同列の feature フォルダ `src/company/` として新設する。
理由: signup / add の 2 つの context（不変条件）を名前付きユニットで明示し、HTTP 非依存に unit test できるようにする。
transaction orchestration を handler 直書きから use-case に移すことで、handler は auth → zod → use-case 呼び出し → 結果の status 変換だけになる。

### サーバ: use-case 層（新設 `src/company/create.ts`）

```ts
import type { OrgCode } from "@/db/repositories/company";

type CreateInput = { name: string; orgCode: OrgCode };

type SignupResult =
  | { ok: true; company: CompanyRow; membership: MembershipRow }
  | { ok: false; reason: "already_exists" };

// context 1: signup（0 件ガード + 409 race 直列化）
export const createSignupCompany = (userId: string, input: CreateInput): Promise<SignupResult> =>
  runInTransaction(async (tx) => {
    await lockUserForCompanyCreation(tx, userId);
    if ((await findMembershipsByUserId(userId, tx)).length > 0) {
      return { ok: false, reason: "already_exists" };
    }
    return { ok: true, ...(await createCompanyWithOwner(tx, userId, input)) };
  });

// context 2: add（制限なし。membership 有無を問わず作成）
export const addCompany = (userId: string, input: CreateInput): Promise<{ company: CompanyRow; membership: MembershipRow }> =>
  runInTransaction((tx) => createCompanyWithOwner(tx, userId, input));

// 共有 primitive: company + OWNER membership + last_used 更新 + audit を 1 tx で
const createCompanyWithOwner = async (tx, userId: string, input: CreateInput) => {
  const company = await insertCompany({ id: generateCompanyId(), name: input.name, orgCode: input.orgCode }, tx);
  const membership = await insertMembership({ id: generateMembershipId(), userId, companyId: company.id, role: "OWNER" }, tx);
  await updateUserLastUsedCompany(userId, company.id, tx); // 作成 = 新事業所へ切替
  await recordCompanyCreated({ actor_user_id: userId, company_id: company.id, name: input.name, org_code: input.orgCode }, tx);
  return { company, membership };
};
```

- `createSignupCompany` は既存 signup handler の inline orchestration を移設したもの（純増ではなく refactor）。
- `addCompany` は 0 件ガードを持たない。`createCompanyWithOwner` が `updateUserLastUsedCompany` で新事業所を current にするため、`company_switched` audit は出さず `company_created` のみ（signup と同じ挙動）。

### サーバ: handler（`src/handlers/account-company.ts`）

- 既存 `POST /api/account/companies`（signup）: `createSignupCompany` を呼び、`{ ok: false }` なら 409、成功なら従来どおり company + membership を返すよう refactor。
- 新規 `POST /api/account/companies/add`: 認証 → `createCompanyBody`（既存 zod スキーマ再利用）で parse → `addCompany` → company + membership を返す。
  - **`/:companyId` param route より前に登録必須**（spike 実測）。Hono 4.7 SmartRouter は静的セグメントを常には優先せず**登録順依存**で、`/add` を param route の後に置くと `/companies/add` が `:companyId="add"` として update handler に吸われ silent bug 化する。`account-company.ts` では signup route の直後・update route の前に配置している。

### クライアント API（`web/src/lib/account-api.ts`）

- `addCompany({ name, org_code })` を追加。`POST /api/account/companies/add` を叩く（既存 `createCompany` と同形）。

### UI

- `web/src/components/account/AddCompanyDialog.tsx` を新規作成。`@/components/ui/dialog` + `TransferOwnershipModal` の流儀に倣う。
  - フォーム: 事業所名（必須）+ 事業形態（法人 / 個人事業主 radio）。`SignUpCompany.tsx` と同じ 2 項目。
  - 成功時: `useCompanyContext().refresh()` を呼ぶ。サーバが last_used を新事業所に更新済みなので current が新事業所に切り替わる。ダイアログを閉じる。
- `web/src/pages/account/Companies.tsx`: ヘッダ右に「+ 事業所を追加」ボタン → ダイアログを開く。

## データフロー（add）

1. ユーザーが所属事業所ページで「+ 事業所を追加」→ ダイアログで名前 + 事業形態を入力 → 送信
2. client `addCompany()` → `POST /api/account/companies/add`
3. handler: auth → zod parse → `addCompany(userId, input)`
4. use-case: 1 tx で insertCompany → insertMembership(OWNER) → updateUserLastUsedCompany(新company) → recordCompanyCreated
5. handler が company + membership を返す
6. client `refresh()` → `getCompanyState()` が `current_company_id = last_used = 新company` を返す → サイドバー switcher / 一覧が新事業所 current に更新、ダイアログを閉じる

## エラーハンドリング

- 未認証 → 401（既存どおり）
- body バリデーション失敗（空名 / 不正 org_code）→ 400、ダイアログ内にメッセージ表示
- add は重複名を許容（制限なし方針）。`already_exists` は signup context にのみ存在し、add では返らない

## テスト

- **use-case unit test**（HTTP 非依存 — Option B の利点）`src/company/__tests__/create.test.ts`:
  - `createSignupCompany`: 0 件で `{ ok: true }` / 既存 membership ありで `{ ok: false, reason: "already_exists" }`
  - `addCompany`: 新 company + OWNER membership + last_used 更新 + `company_created` audit
  - `addCompany` を PERSONAL で 2 回 → 両方成功（制限なし）
- **handler test**: 新 `POST /api/account/companies/add` の成功パス / signup endpoint の 0 件ガード・409 が**温存されている回帰**
- **UI（実ブラウザ chrome MCP）**: ダイアログ送信 → 一覧・サイドバー switcher に新事業所が current で出る

## Prototype で先に検証する load-bearing assumption

1. add → refresh で「現在の事業所」が新事業所に切り替わり、サイドバー switcher と一覧に出る（実ブラウザ）
2. `POST /api/account/companies/add` が `/:companyId` param route と衝突せず正しく解決される
3. 新規作成直後の OWNER membership で表示・後続操作（設定 / メンバー）が正常
4. ダイアログ UX が Companies ページに馴染む

## 可逆性 / blast radius

- DB スキーマ変更なし（company / membership テーブルは既存）
- 内部 account API への additive な新エンドポイント。auth-client SDK の公開契約は不変
- → reversible・小 blast radius のため iterate-with-prototypes に適合
