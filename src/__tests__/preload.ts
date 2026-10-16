import { boot } from "../boot";
import { recordingEmailSender } from "../testing/magic-link-outbox";
import { TEST_MFA_TOTP_ENCRYPTION_KEYS } from "./test-env";
import { testMagicLinkOutbox } from "./test-magic-link-outbox";
import { testTtlStore } from "./test-ttl-store";

process.env.MFA_TOTP_ENCRYPTION_KEYS ??= TEST_MFA_TOTP_ENCRYPTION_KEYS;
boot(testTtlStore, recordingEmailSender(testMagicLinkOutbox));
