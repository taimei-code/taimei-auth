import { expect, test } from "bun:test";
import type { PasskeyRow } from "../repositories/passkey";

type CredentialAndUsageColumn =
  | "id"
  | "userId"
  | "credentialId"
  | "publicKey"
  | "counter"
  | "aaguid"
  | "transports"
  | "createdAt"
  | "lastUsedAt";

type ColumnBeyondCredentialAndUsage = Exclude<keyof PasskeyRow, CredentialAndUsageColumn>;

const _noStateLockOrQuotaColumn: [ColumnBeyondCredentialAndUsage] extends [never] ? true : false =
  true;

test("パスキーの表は資格情報と使った記録の 9 列だけを持ち、状態・lock・枠を表す列を足すと型エラーになる (ADR-0029。typecheck で検査する)", () => {
  expect(_noStateLockOrQuotaColumn).toBe(true);
});
