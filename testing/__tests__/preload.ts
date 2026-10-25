import { databaseTarget } from "../../db/testing/local-database";
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

const target = databaseTarget(process.env.DATABASE_URL);
if (target._tag === "Remote") {
  throw new Error(
    `DATABASE_URL の host "${target.hostname ?? "(URL として読めない)"}" は local の DB ではない。bun test は試験の行を作って消すので、local の Postgres に向ける`,
  );
}

process.env.MFA_TOTP_ENCRYPTION_KEYS ??= TEST_MFA_TOTP_ENCRYPTION_KEYS;
process.env.AUTH_SERVICE_URL ??= TEST_AUTH_SERVICE_URL;
process.env.AUTH_TRUSTED_ORIGINS ??= TEST_AUTH_TRUSTED_ORIGINS;
process.env.AUTH_SERVICE_KEY ??= TEST_AUTH_SERVICE_KEY;
process.env.AUTH_TRUSTED_PROXY_HOPS ??= TEST_AUTH_TRUSTED_PROXY_HOPS;
boot(testTtlStore, recordingEmailSender);
