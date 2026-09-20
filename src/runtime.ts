import { Layer, ManagedRuntime } from "effect";
import { AccountLayers } from "./account/wiring";
import { BackgroundLive } from "./background";
import { EmailSenderLive } from "./email/wiring";
import { HealthRepoLive } from "./health/wiring";
import { TtlStoreLive } from "./ttl-store-service";
import { SentryLive } from "./sentry";
import { AuditLogLive } from "./audit/wiring";
import { AuthApiLive } from "./auth-wiring";
import { CompanyRepoLive } from "./company/wiring";
import { IdGeneratorLive } from "./id-generator";
import { InvitationRepoLive } from "./invitation/wiring";
import { MembershipRepoLive } from "./membership/wiring";
import { MfaLayers } from "./mfa/totp/wiring";
import { TransactionLive } from "./transaction";

export const AppLayer = Layer.mergeAll(
  AuthApiLive,
  AccountLayers,
  MembershipRepoLive,
  InvitationRepoLive,
  CompanyRepoLive,
  AuditLogLive,
  MfaLayers,
  TransactionLive,
  IdGeneratorLive,
  TtlStoreLive,
  SentryLive,
  BackgroundLive,
  EmailSenderLive,
  HealthRepoLive,
);

export type AppServices = Layer.Success<typeof AppLayer>;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

let runtime: AppRuntime | undefined;

export function getRuntime(): AppRuntime {
  runtime ??= ManagedRuntime.make(AppLayer);
  return runtime;
}
