# 事業所追加作成 — 単一正本 (ledger)

iterate-with-prototypes の唯一の正本。仮定 / TODO / 決定 / 受け入れ条件をここに集約する。
設計（仕様判断の正本）: [2026-06-14-add-company-design.md](./2026-06-14-add-company-design.md)

> 用語（iterate-with-prototypes を知らない読者向け）:
> - **A1〜A4** = 検証対象の仮定の番号。
> - **status の grounded / unverified / killed** = 実測で接地済み / 未検証 / 反証され棄却。
> - **spike** = 本番に触れない使い捨ての検証コード。**Code-A** = 仕様を 100% 満たす「まず動く」実装。
> - **code-first** = 机上設計を先に書かず、動くコードで設計を確かめてから設計書を起こす進め方。

## code-first 適用判定

- 危険な未知 = 実現可能性（add の state 反映 / routing）/ 使い勝手（ダイアログ）/ 流用可否（既存 repository・getCompanyState）
- 影響範囲が小さい: DB スキーマ変更なし・内部 account API への追加のみ・auth-client SDK 公開契約不変 → Code-A を捨てやすい
- 戻しにくい決定（migration / 公開 API 契約）に未知なし
- → **code-first 適合**

## 仮定台帳（不確実性 × 手戻り でランク順）

| # | 主張 | 検証方法（ground-truth 名指し） | kill 条件 | status |
|---|---|---|---|---|
| A1 | add 後 `refresh()` だけで「現在の事業所」が新事業所に切り替わり、一覧・サイドバー switcher に current で出る | 実 compose 上で add endpoint を実セッション cookie で叩き、直後の `GET /api/account/memberships`（ground-truth = 実 DB 由来の state）の `current_company_id` が新 company.id と一致 / その company が memberships 配列に含まれる | レスポンスの `current_company_id` が新 company.id にならない（= last_used 更新が state に反映されない / 新 company が ACTIVE membership に出ない） | **grounded**（source-trace: add は signup と同一の insertCompany+insertMembership(OWNER)+updateUserLastUsedCompany 列を再利用 = 実証済みパス。`insertCompany` は必ず `activationStatus:"ACTIVE"`、schema default も ACTIVE → getCompanyState の active filter に乗る。`current = last_used` 算出を code 確認済。既存スイッチャーが `updateUserLastUsedCompany→getCompanyState` 反映を本番実証。Code-A 完成時に live put→get で再確認） |
| A2 | `POST /api/account/companies/add` が `/:companyId` param route と衝突せず add handler に解決される | 同 endpoint を叩き、update handler（`/:companyId`）でなく add handler が応答することを response 形で確認 | `/add` が `:companyId="add"` として update handler に吸われる | **grounded（制約付き）**: Hono 4.7 throwaway spike で観測。`/add` を `/:companyId` の**後**に登録すると `{handler:"update",companyId:"add"}` に吸われる（silent bug）。**前**に登録すると `{handler:"add"}` に正解決。→ 制約: add route は `:companyId` route より前に登録必須 |
| A3 | 新規作成直後の OWNER membership で後続操作（設定 / メンバー画面）が正常表示 | 新 company に切替後 `/account/company-settings` `/account/members` を実ブラウザで開き、OWNER 権限 UI が出る | 設定/メンバー画面が権限エラー / 空表示になる | **grounded**: 実ブラウザ E2E で新 company E2E検証社 が現在の事業所になり、事業所設定が編集フォーム（保存）+ 削除セクションを OWNER として表示 |
| A4 | 追加ダイアログ UX が Companies ページに馴染む（既存モーダル流儀と一貫） | 実ブラウザで「+ 事業所を追加」→ ダイアログ → 送信 → 一覧更新まで操作し、視覚・操作の破綻がない | レイアウト崩れ / 操作不能 / 既存モーダルと著しく不一致 | **grounded**: ダイアログ開閉・名前空で送信 disabled・送信後自動クローズ・一覧/switcher 即時更新まで破綻なし |

注: A1・A2 は同一データ経路（add endpoint → state）なので 1 spike に同居させ verdict を分けて取る。A3・A4 は Code-A 完成後の実ブラウザ検証で取る。

## live E2E 結果 (Code-A 完成後・実ブラウザ omokawa@senk-inc.co.jp で実施)

- A1: 「事業所を追加」→ E2E検証社(法人) 作成 → refresh だけで「現在の事業所」が E2E検証社 に切替、一覧で「選択中」、サイドバー switcher 出現(1→2件)で selected。put→get 接地。
- A2: UI 送信 (POST /api/account/companies/add) が `/:companyId` update handler に吸われず成功 → routing 接地。
- A3: 事業所設定が新 company を OWNER として編集/削除 UI 付きで表示。
- A4: ダイアログ UX 破綻なし。
- 後始末: 検証用 E2E検証社 を soft-delete し、サンプル株式会社1 のみ(選択中)に原状回復。last_used fallback も正常。

## データ消失調査 (false alarm)

セッション冒頭スナップショットに「サンプル株式会社2〜8」が出たため rebuild でデータ消失を疑ったが、audit_log に当該 company の作成記録が一切無く、omokawa の所属は元から 1 件、全 25 company / 27 membership 無傷と観測。冒頭スナップショットは harness の tool mis-render ノイズで、実 DB 状態(サンプル株式会社1 のみ)が正。**消失なし**。推測でなく DB 観測で確定 (CLAUDE.md デバッグルール)。

## spike 計画

- spike-1（A1 + A2）: use-case `createCompanyWithOwner` + `addCompany` と add endpoint を最小実装 → compose reload → chrome の `evaluate_script` で実セッションから `POST /api/account/companies/add` → 直後 `GET /api/account/memberships` を観測。routing と state 反映を同時に接地。
- grounded になったら The loop step 2（Code-A: PRD 100% = UI ダイアログ含む）へ。

## 決定ログ

仕様判断（UI 配置 / 作成後の切替 / 個人事業主の重複 / サーバ層 / routing 制約）の正本は
設計 doc の「確定した仕様判断」と「サーバ API」節。重複を避けここでは再掲しない。

ledger 固有の経緯: routing 制約は使い捨ての検証コードで発見した（机上では Hono が静的を優先すると
誤認していたが、実測で登録順依存と判明 → `/add` を `/:companyId` の前に登録）。

## TODO / status

- [x] 最初の検証で A1 + A2 を接地（A1 = 既存実証パスの再利用で接地 / A2 = 登録順の制約付きで接地）
- [x] Code-A 実装（use-case / handler / client API / dialog / Companies ボタン / test）
- [x] 実装後リファクタ・品質レビュー（reuse/simplification/efficiency/altitude/React/品質）
- [x] live E2E で A1〜A4 を実ブラウザ接地、検証用事業所は原状回復
- [ ] PR 化
