-- ADR-009: 既存 user 全員に「<name> の事業所」 (= PERSONAL / OWNER membership) を 1 件 backfill。
-- 本番デプロイ前の staging のみで意味があり、本番ロンチ後は signup フローで必ず company が作られるため不要。
-- 同 user に対する 2 重実行を防ぐため `WHERE NOT EXISTS (SELECT 1 FROM membership WHERE user_id = u.id)` で gate。
-- migrate-manual.ts が起動毎に呼ぶため idempotent。
--
-- N:M 破壊防止: 単一 CTE 内で user → company → membership を「同じ user 1 行から派生する 3 つの ID」として
-- 同時に決定し、user.id を carrier として運ぶ。
-- 旧案は company INSERT 後に name で JOIN し直していたため、name 衝突した別 user 行の company に
-- 誤った OWNER membership が紐付くリスクがあった (CR1 / WB-C1)。

WITH targets AS (
  SELECT
    u.id AS user_id,
    'cmp_' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_') AS new_company_id,
    'mbr_' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_') AS new_membership_id,
    COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) || ' の事業所' AS company_name
  FROM "user" u
  WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id)
),
ins_company AS (
  INSERT INTO company (id, name, org_code, activation_status, created_at, updated_at)
  SELECT new_company_id, company_name, 'PERSONAL', 'ACTIVE', now(), now()
  FROM targets
  RETURNING id
),
ins_membership AS (
  -- ins_company の RETURNING に JOIN することで「company INSERT が成功した行のみ」
  -- に membership INSERT が連動する。targets を直参照すると ins_company が conflict 等で
  -- 0 行に縮退したとき FK 違反になりうる。
  INSERT INTO membership (id, user_id, company_id, role, joined_at, created_at, updated_at)
  SELECT t.new_membership_id, t.user_id, ic.id, 'OWNER', now(), now(), now()
  FROM ins_company ic
  JOIN targets t ON t.new_company_id = ic.id
  RETURNING user_id, company_id
)
UPDATE "user" u
SET last_used_company_id = im.company_id
FROM ins_membership im
WHERE u.id = im.user_id AND u.last_used_company_id IS NULL;
