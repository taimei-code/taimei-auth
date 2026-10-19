import { Layer, ManagedRuntime } from "effect";
import { UserRepoLive } from "./account/wiring";
import { BackgroundLive } from "./background";
import { EmailSenderLive } from "./email/wiring";
import type { EmailSender } from "./email/ports";
import { HealthRepoLive } from "./health/wiring";
import { ttlStoreLayer } from "./ttl-store-service";
import type { TtlStoreBackend } from "./ttl-store";
import { SentryLive } from "./sentry";
import { AuditLogLive } from "./audit/wiring";
import { AuthApiLive } from "./auth-wiring";
import { CompanyRepoLive } from "./company/wiring";
import { IdGeneratorLive } from "./id-generator";
import { InvitationRepoLive } from "./invitation/wiring";
import { MembershipRepoLive } from "./membership/wiring";
import { MfaLayers } from "./mfa/totp/wiring";
import { TransactionLive } from "./transaction";

export const appLayer = (
  ttlStore: TtlStoreBackend,
  emailSender: Layer.Layer<EmailSender> = EmailSenderLive,
) =>
  Layer.mergeAll(
    AuthApiLive,
    UserRepoLive,
    MembershipRepoLive,
    InvitationRepoLive,
    CompanyRepoLive,
    AuditLogLive,
    MfaLayers,
    TransactionLive,
    IdGeneratorLive,
    ttlStoreLayer(ttlStore),
    SentryLive,
    BackgroundLive,
    emailSender,
    HealthRepoLive,
  );

export type AppServices = Layer.Success<ReturnType<typeof appLayer>>;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

let runtime: AppRuntime | undefined;

export function initRuntime(
  ttlStore: TtlStoreBackend,
  emailSender?: Layer.Layer<EmailSender>,
): AppRuntime {
  runtime ??= ManagedRuntime.make(appLayer(ttlStore, emailSender));
  return runtime;
}

export function getRuntime(): AppRuntime {
  if (!runtime) throw new Error("getRuntime: initRuntime(ttlStore) を先に呼ぶ");
  return runtime;
}
