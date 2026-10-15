import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { SentryLive } from "../../sentry";
import { appendAuditBestEffort, signInEntry } from "../append";
import { AuditLog } from "../ports";

const entry: AuditLogEntry = { eventType: "account_delete", userId: "u1", payload: {} };

const auditLogWhere = (appendAuditLog: AuditLog["Service"]["appendAuditLog"]) =>
  Layer.succeed(AuditLog, AuditLog.of({ appendAuditLog } as AuditLog["Service"]));

describe("appendAuditBestEffort", () => {
  const { exceptions: captured } = recordSentry();
  const run = (layer: Layer.Layer<AuditLog>) =>
    Effect.runPromise(
      Effect.exit(appendAuditBestEffort(entry)).pipe(Effect.provide([layer, SentryLive])),
    );

  test("記帳に成功すると undefined で終わり、Sentry に送らない", async () => {
    const before = captured.length;
    expect(await run(auditLogWhere(() => Effect.void))).toEqual(Exit.succeed(undefined));
    expect(captured.length).toBe(before);
  });

  test("記帳に失敗しても成功で終わり、Sentry に level error と component・event の tag で送る", async () => {
    const cause = new Error("db down");
    const before = captured.length;
    const exit = await run(auditLogWhere(() => Effect.fail(new DbError({ cause }))));
    expect(exit).toEqual(Exit.succeed(undefined));
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({
      level: "error",
      tags: { component: "audit-log", event: "account_delete" },
    });
  });
});

describe("signInEntry", () => {
  test("request の IP と User-Agent を payload に載せる", () => {
    const headers = new Headers({ "user-agent": "ua/1" });
    expect(signInEntry("u1", "magic_link", headers)).toEqual({
      eventType: "sign_in",
      userId: "u1",
      payload: { method: "magic_link", ip: "unknown", userAgent: "ua/1" },
    });
  });
});

type PayloadKeys<E extends AuditLogEntry["eventType"]> = keyof Extract<
  AuditLogEntry,
  { eventType: E }
>["payload"];
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _payloadKeysReadByMonitoringQueries: {
  [E in AuditLogEntry["eventType"]]: true;
} = {
  sign_in: true satisfies Exactly<PayloadKeys<"sign_in">, "method" | "ip" | "userAgent">,
  mfa_enabled: true satisfies Exactly<PayloadKeys<"mfa_enabled">, "ip" | "userAgent">,
  mfa_disabled: true satisfies Exactly<PayloadKeys<"mfa_disabled">, "ip" | "userAgent">,
  account_delete: true satisfies Exactly<PayloadKeys<"account_delete">, string>,
  company_created: true satisfies Exactly<
    PayloadKeys<"company_created">,
    "company_id" | "name" | "org_code" | "created_by_user_id"
  >,
  company_updated: true satisfies Exactly<
    PayloadKeys<"company_updated">,
    "company_id" | "before" | "after"
  >,
  company_deleted: true satisfies Exactly<
    PayloadKeys<"company_deleted">,
    "company_id" | "name_at_deletion" | "deleted_by_user_id"
  >,
  invitation_sent: true satisfies Exactly<
    PayloadKeys<"invitation_sent">,
    "invitation_id" | "company_id" | "invited_email" | "role" | "invited_by_user_id"
  >,
  invitation_accepted: true satisfies Exactly<
    PayloadKeys<"invitation_accepted">,
    "invitation_id" | "company_id" | "accepted_by_user_id" | "role"
  >,
  invitation_revoked: true satisfies Exactly<
    PayloadKeys<"invitation_revoked">,
    "invitation_id" | "company_id" | "revoked_by_user_id"
  >,
  invitation_accept_rejected: true satisfies Exactly<
    PayloadKeys<"invitation_accept_rejected">,
    "invitation_id" | "company_id" | "invited_by_user_id" | "attempted_role" | "inviter" | "reason"
  >,
  membership_removed: true satisfies Exactly<
    PayloadKeys<"membership_removed">,
    "company_id" | "removed_user_id" | "removed_by_user_id" | "role_at_removal" | "was_self"
  >,
  role_changed: true satisfies Exactly<
    PayloadKeys<"role_changed">,
    "company_id" | "target_user_id" | "before_role" | "after_role" | "changed_by_user_id"
  >,
  ownership_transferred: true satisfies Exactly<
    PayloadKeys<"ownership_transferred">,
    "company_id" | "from_user_id" | "to_user_id"
  >,
  company_switched: true satisfies Exactly<
    PayloadKeys<"company_switched">,
    "from_company_id" | "to_company_id"
  >,
};
