CREATE TABLE "mfa_registration_guard_protocol" (
	"protocol_key" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "mfa_registration_guard_protocol_key_check" CHECK ("mfa_registration_guard_protocol"."protocol_key" = 'mfa_registration_guard'),
	CONSTRAINT "mfa_registration_guard_protocol_version_check" CHECK ("mfa_registration_guard_protocol"."version" > 0)
);
