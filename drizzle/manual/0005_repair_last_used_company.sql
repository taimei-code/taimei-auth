-- 除名の後も除名された事業所を指したままの値と、#223 より前の招待受諾が書かなかった NULL を直す

UPDATE "user" u
SET last_used_company_id = (
  SELECT m.company_id FROM membership m
  JOIN company c ON c.id = m.company_id
  WHERE m.user_id = u.id AND c.activation_status = 'ACTIVE'
  LIMIT 1
)
WHERE NOT EXISTS (
  SELECT 1 FROM membership m
  JOIN company c ON c.id = m.company_id
  WHERE m.user_id = u.id AND m.company_id = u.last_used_company_id AND c.activation_status = 'ACTIVE'
)
AND (
  u.last_used_company_id IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM membership m
    JOIN company c ON c.id = m.company_id
    WHERE m.user_id = u.id AND c.activation_status = 'ACTIVE'
  )
);
