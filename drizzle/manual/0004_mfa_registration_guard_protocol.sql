INSERT INTO "mfa_registration_guard_protocol" ("protocol_key", "version")
VALUES ('mfa_registration_guard', 1)
ON CONFLICT ("protocol_key") DO NOTHING;
