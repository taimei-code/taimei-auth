import { Layer, ManagedRuntime } from "effect";
import { AccountLayers } from "./account/wiring";
import { BackgroundLive } from "./background";
import { EmailSenderLive } from "./email/wiring";
import { HealthRepoLive } from "./health/wiring";
import { RedisLive } from "./redis-service";
import { SentryLive } from "./sentry";
import { AuditLogLive } from "./audit/wiring";
import { AuthApiLive } from "./auth-service";
import { CompanyRepoLive } from "./company/wiring";
import { IdGeneratorLive } from "./id-generator";
import { InvitationRepoLive } from "./invitation/wiring";
import { MembershipRepoLive } from "./membership/wiring";
import { MfaLayers } from "./mfa/totp/wiring";
import { TransactionLive } from "./transaction";

// Effect runtime (ADR-0017 Decision の runtime 項)。AppLayer は I/O resource を持たない (pg.Pool は db/client.ts の
// ALS、Redis client は initRedis() が持つ) ので、isolate / process に 1 つを memo して使い回せる。
// 生成は最初の getRuntime() まで遅延する lazy accessor。Workers は bootstrap(env) の末尾で 1 回呼んで fail-fast
// にし (src/worker.ts)、Bun entry と fixture test は最初の adapter 呼び出しで作る。
// dispose 契機は Workers に無い (isolate 回収) ため Layer に finalizer を要する resource を置かない。
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
  RedisLive,
  SentryLive,
  BackgroundLive,
  EmailSenderLive,
  HealthRepoLive,
);

export type AppServices = Layer.Success<typeof AppLayer>;

let runtime: ManagedRuntime.ManagedRuntime<AppServices, never> | undefined;

// AuthApiLive は auth (ESM live binding) を呼び出し時に読むため、runtime 自体は initAuth() の前後どちらで
// 作っても安全。順序の assert は置かない (置くと route / middleware 全部に Hono が飲み込む新しい throw 経路が増える)。
export function getRuntime(): ManagedRuntime.ManagedRuntime<AppServices, never> {
  runtime ??= ManagedRuntime.make(AppLayer);
  return runtime;
}
