-- ADR-009 に基づき、既存の user 全員に「<name> の事業所」(PERSONAL な company と OWNER の membership) を 1 件ずつ backfill する。
-- 本番デプロイ前の staging でだけ意味があり、本番ロンチ後は signup フローで必ず company が作られるため不要になる。
-- 同じ user に対して 2 回実行しないよう、`WHERE NOT EXISTS (SELECT 1 FROM membership WHERE user_id = u.id)` で対象を絞る。
-- migrate-manual.ts が起動のたびに呼ぶため冪等にしてある。
--
-- N:M の対応を壊さないために、1 つの CTE の中で user、company、membership の 3 つの ID を「同じ user 1 行から導く」形で
-- 同時に決め、user.id を使って各 INSERT を結び付ける。
-- 以前の案は company の INSERT 後に name で JOIN し直していたため、name が衝突した別の user 行の company に
-- 誤った OWNER membership が紐付くおそれがあった (CR1、WB-C1)。

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
  -- ins_company の RETURNING に JOIN することで、company の INSERT が成功した行に対してだけ
  -- membership を INSERT する。targets を直接参照すると、ins_company が conflict などで
  -- 0 行になった時に FK 違反になりうる。
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
