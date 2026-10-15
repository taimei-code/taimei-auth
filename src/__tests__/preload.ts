import { boot } from "../boot";
import { TEST_MFA_TOTP_ENCRYPTION_KEYS } from "./test-env";
import { testTtlStore } from "./test-ttl-store";

process.env.MFA_TOTP_ENCRYPTION_KEYS ??= TEST_MFA_TOTP_ENCRYPTION_KEYS;
boot(testTtlStore);
