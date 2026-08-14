import {
  acquireRegistrationGuard,
  releaseRegistrationGuard,
} from "@/db/repositories/mfa-registration";
import type { Actor } from "../../membership/guard/core";
import { activate as activateOperation } from "./activate";
import { createRegistrationApplication } from "./application";
import type { RegistrationPrincipal } from "./contracts";
import { disable as disableOperation } from "./disable";
import { enroll as enrollOperation } from "./enroll";
import { notifyMfaDisabled, notifyMfaEnabled } from "./notification-adapter";
import { reportUnknownMfaRegistrationTransition } from "./observability-adapter";
import type { RegistrationSnapshot } from "./ports";
import { restart as restartOperation } from "./restart";
import { readStatus } from "./status";

// self-service と management の両経路が同じ production guard 配線を共有する (二重定義で
// 片方だけ計測やアダプタ差替えが漏れる drift を防ぐ)。
export const registrationGuard = {
  acquire: acquireRegistrationGuard,
  release: releaseRegistrationGuard,
};

export const registrationApplication = createRegistrationApplication({
  guard: registrationGuard,
  reportUnknownTransition: reportUnknownMfaRegistrationTransition,
  notifyEnabled: notifyMfaEnabled,
  notifyDisabled: notifyMfaDisabled,
  operations: {
    getStatus: (principal) => readStatus(actorFor(principal)),
    enroll: ({ principal, headers, snapshot }) =>
      enrollOperation(actorFor(principal, snapshot), headers, snapshot),
    restart: ({ principal, headers, snapshot, enrollmentId }) =>
      restartOperation({ actor: actorFor(principal, snapshot), headers, enrollmentId, snapshot }),
    async activate({ principal, headers, snapshot, enrollmentId, code }) {
      const result = await activateOperation({
        actor: actorFor(principal, snapshot),
        headers,
        enrollmentId,
        code,
        snapshot,
      });
      return result.ok
        ? { ok: true, sessionChanges: result.forwardedHeaders, notifyEmail: result.notifyEmail }
        : result;
    },
    async disable({ principal, headers, snapshot, code, kind }) {
      const result = await disableOperation({
        actor: actorFor(principal, snapshot),
        headers,
        code,
        kind,
        snapshot,
      });
      return result.ok
        ? { ok: true, sessionChanges: result.forwardedHeaders, notifyEmail: result.notifyEmail }
        : result;
    },
  },
});

// snapshot があれば guard 取得時点の状態を、なければ requireActor が読んだリクエスト時点の状態を使う。
function actorFor(principal: RegistrationPrincipal, snapshot?: RegistrationSnapshot): Actor {
  if (snapshot?.user === "present") {
    return {
      id: principal.userId,
      email: snapshot.email,
      lastUsedCompanyId: null,
      twoFactorEnabled: snapshot.twoFactorEnabled,
    };
  }
  return {
    id: principal.userId,
    email: principal.email,
    lastUsedCompanyId: null,
    // snapshot が user 不在を観測したら request 時点のフラグは信じない (削除済み user を有効扱いしない)。
    twoFactorEnabled: snapshot === undefined ? principal.twoFactorEnabled : false,
  };
}
