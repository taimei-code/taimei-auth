import { boot } from "../../src/boot";
import { recordingEmailSender } from "../magic-link-outbox";
import {
  TEST_AUTH_SERVICE_URL,
  TEST_AUTH_TRUSTED_ORIGINS,
  TEST_MFA_TOTP_ENCRYPTION_KEYS,
} from "../../src/__tests__/test-env";
import { testMagicLinkOutbox } from "./test-magic-link-outbox";
import { testTtlStore } from "../../src/__tests__/test-ttl-store";

process.env.MFA_TOTP_ENCRYPTION_KEYS ??= TEST_MFA_TOTP_ENCRYPTION_KEYS;
process.env.AUTH_SERVICE_URL ??= TEST_AUTH_SERVICE_URL;
process.env.AUTH_TRUSTED_ORIGINS ??= TEST_AUTH_TRUSTED_ORIGINS;
boot(testTtlStore, recordingEmailSender(testMagicLinkOutbox));
