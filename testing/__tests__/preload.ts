import { requireLocalDatabase } from "../../db/testing/local-database";
import { boot } from "../../src/boot";
import {
  TEST_AUTH_SERVICE_KEY,
  TEST_AUTH_SERVICE_URL,
  TEST_AUTH_TRUSTED_ORIGINS,
  TEST_AUTH_TRUSTED_PROXY_HOPS,
  TEST_MFA_TOTP_ENCRYPTION_KEYS,
} from "../../src/__tests__/test-env";
import { testTtlStore } from "../../src/__tests__/test-ttl-store";
import { recordingEmailSender } from "../sent-links";

if (process.env.DATABASE_URL) requireLocalDatabase(process.env.DATABASE_URL);

process.env.MFA_TOTP_ENCRYPTION_KEYS ??= TEST_MFA_TOTP_ENCRYPTION_KEYS;
process.env.AUTH_SERVICE_URL ??= TEST_AUTH_SERVICE_URL;
process.env.AUTH_TRUSTED_ORIGINS ??= TEST_AUTH_TRUSTED_ORIGINS;
process.env.AUTH_SERVICE_KEY ??= TEST_AUTH_SERVICE_KEY;
process.env.AUTH_TRUSTED_PROXY_HOPS ??= TEST_AUTH_TRUSTED_PROXY_HOPS;
boot(testTtlStore, recordingEmailSender);
