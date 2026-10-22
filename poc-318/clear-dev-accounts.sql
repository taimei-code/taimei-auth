DELETE FROM membership WHERE user_id LIKE 'dev-account-%' OR company_id LIKE 'cmp_dev_company_%';
DELETE FROM "user" WHERE id LIKE 'dev-account-%';
DELETE FROM company WHERE id LIKE 'cmp_dev_company_%';
SELECT (SELECT count(*) FROM "user" WHERE id LIKE 'dev-account-%') AS users, (SELECT count(*) FROM membership WHERE user_id LIKE 'dev-account-%') AS memberships, (SELECT count(*) FROM company WHERE id LIKE 'cmp_dev_company_%') AS companies;
