// PoC の型 probe。各 @ts-expect-error の行が型エラーにならなければ tsc が TS2578 で落ちる
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { EmailMismatch } from "../membership/guard/errors";
import { AccountApi } from "../membership/members-api";

const ok = { ok: true as const };

export const k3 = HttpApiBuilder.group(AccountApi, "members", (h) =>
  h
    // @ts-expect-error K3 応答の形が契約と違う
    .handle("list", () => Effect.succeed({ members: [{ wrong: 1 }] }))
    .handle("pendingInvitations", () => Effect.succeed({ invitations: [] }))
    .handle("changeRole", () => Effect.succeed(ok))
    .handle("remove", () => Effect.succeed({ ...ok, account_deleted: false }))
    .handle("transferOwnership", () => Effect.succeed(ok)),
);

export const k4 = HttpApiBuilder.group(AccountApi, "members", (h) =>
  h
    // @ts-expect-error K4 宣言していない失敗を返す
    .handle("list", () => Effect.fail(new EmailMismatch()))
    .handle("pendingInvitations", () => Effect.succeed({ invitations: [] }))
    .handle("changeRole", () => Effect.succeed(ok))
    .handle("remove", () => Effect.succeed({ ...ok, account_deleted: false }))
    .handle("transferOwnership", () => Effect.succeed(ok)),
);

export const k6 = HttpApiBuilder.group(AccountApi, "members", (h) =>
  // @ts-expect-error K6 handler の書き漏れ (remove が無い)
  h
    .handle("list", () => Effect.succeed({ members: [] }))
    .handle("pendingInvitations", () => Effect.succeed({ invitations: [] }))
    .handle("changeRole", () => Effect.succeed(ok))
    .handle("transferOwnership", () => Effect.succeed(ok)),
);
