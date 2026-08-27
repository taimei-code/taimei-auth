import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  acquireRegistrationGuard,
  releaseRegistrationGuard,
} from "@/db/repositories/mfa-registration";
import { mfaRegistrationTransitionGuard } from "@/db/schema";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { setSentryBackend, type CaptureContext } from "../../sentry";
import { enroll } from "../registration";

// self-service 経路の観測結線 (wiring.ts → observability-adapter → Sentry) を production 束縛のまま
// 検証する。reportUnknownTransition の必須化は「束縛の消失」を typecheck で塞ぐが、「明示 no-op への
// 差し替え」は塞げないため、ここが self-service 側の唯一の検知面 (management 側は
// management-application.test.ts が production adapter 込みで担う)。
// 滞留 guard (15 分超) の phase:acquire 通報を使うのは、production operations を故障させずに
// reporter まで到達できる唯一の分岐のため。

const P = "mfa-wiring-obs-";
const { cleanup, seedUser } = createSeedHelpers(P);

// Sentry backend は module-global で、戻し忘れは後続 test file に漏れる (error-mapping.test と同じ規律)。
const consoleFallback = {
  captureException: (error: unknown) => console.error("[sentry:noop] captureException", error),
  captureMessage: (message: string) => console.warn("[sentry:noop] captureMessage", message),
};

describe("registration wiring observability", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("stale guard 越しの enroll が production 結線の Sentry 通報に到達する", async () => {
    const user = await seedUser("stale");
    const acquired = await acquireRegistrationGuard(user.id, "enroll");
    if (!acquired.acquired) throw new Error("test guard was not acquired");
    const captured: { error: unknown; context?: CaptureContext }[] = [];
    setSentryBackend({
      captureException: (error: unknown, context?: CaptureContext) => {
        captured.push({ error, context });
      },
      captureMessage: () => undefined,
    });

    try {
      await db
        .update(mfaRegistrationTransitionGuard)
        .set({ acquiredAt: new Date(Date.now() - 16 * 60 * 1000) })
        .where(eq(mfaRegistrationTransitionGuard.userId, user.id));

      const result = await enroll({
        actor: { id: user.id, email: user.email, twoFactorEnabled: false },
        headers: new Headers(),
      });

      expect(result).toEqual({
        ok: false,
        error: "temporarily_unavailable",
        status: 503,
        retryAfterSeconds: 10,
      });
      expect(captured).toHaveLength(1);
      expect(captured[0]?.context?.tags).toEqual({
        component: "mfa-registration-transition",
        operation: "enroll",
        phase: "acquire",
      });
      expect(String(captured[0]?.error)).toContain("stale");
    } finally {
      setSentryBackend(consoleFallback);
      await releaseRegistrationGuard(acquired.hold);
    }
  });
});
