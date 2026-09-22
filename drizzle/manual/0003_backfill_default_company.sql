-- 本番ロンチ前の staging 用 backfill (ロンチ後は signup が必ず company を作るため対象が無くなる)。migrate-manual.ts が起動のたびに呼ぶため冪等
-- 3 つの ID は 1 つの CTE で同じ user 行から導く。company を INSERT 後に name で JOIN し直すと、name が衝突した別 user の company に OWNER が紐付く

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
  -- targets を直接参照すると ins_company が 0 行の時に FK 違反になりうるため RETURNING に JOIN する
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
