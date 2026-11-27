import { Context, Effect, Layer } from "effect";
import type { Actor } from "./account/actor-contract";

export const FEATURE_FLAGS_BINDING = "FLAGS";

export type FlagAudience = "everyone" | "companies";

export interface FeatureFlagRegistry {}

export type FeatureFlag = Extract<keyof FeatureFlagRegistry, string>;

export type FlagsEvaluatedFor<Audience extends FlagAudience> = {
  [F in FeatureFlag]: FeatureFlagRegistry[F] extends Audience ? F : never;
}[FeatureFlag];

export type FlagActor = Pick<Actor, "lastUsedCompanyId">;

export type FlagContext = { readonly companyId?: string };

export const flagContextOf = (actor: FlagActor | undefined): FlagContext => {
  const companyId = actor?.lastUsedCompanyId;
  return typeof companyId === "string" ? { companyId } : {};
};

export class FeatureFlags extends Context.Service<
  FeatureFlags,
  { readonly isOn: (flag: string, context: FlagContext) => Effect.Effect<boolean> }
>()("taimei/FeatureFlags") {}

export const enabled: {
  (flag: FlagsEvaluatedFor<"everyone">): Effect.Effect<boolean, never, FeatureFlags>;
  (
    flag: FlagsEvaluatedFor<"companies">,
    actor: FlagActor,
  ): Effect.Effect<boolean, never, FeatureFlags>;
} = (flag: FeatureFlag, actor?: FlagActor) =>
  FeatureFlags.use((flags) => flags.isOn(flag, flagContextOf(actor)));

export type FeatureFlagsEnv = { readonly [FEATURE_FLAGS_BINDING]: Flagship };

const OFF_WHEN_UNEVALUATED = false;

const EVALUATION_TIMEOUT = "2 seconds";

const MISSING_FLAG_ERROR_CODE = "FLAG_NOT_FOUND";

const offAfterFailure = (flag: string, reason: string) =>
  Effect.logWarning("feature-flags: evaluation failed", flag, reason).pipe(
    Effect.as(OFF_WHEN_UNEVALUATED),
  );

export const flagshipFeatureFlags = (env: {
  readonly [FEATURE_FLAGS_BINDING]: Pick<Flagship, "getBooleanDetails">;
}): Layer.Layer<FeatureFlags> => {
  const binding = env[FEATURE_FLAGS_BINDING];
  return Layer.succeed(FeatureFlags, {
    isOn: (flag, context) =>
      Effect.tryPromise({
        try: () => binding.getBooleanDetails(flag, OFF_WHEN_UNEVALUATED, context),
        catch: (thrown) => (thrown instanceof Error ? thrown.message : String(thrown)),
      }).pipe(
        Effect.timeout(EVALUATION_TIMEOUT),
        Effect.matchEffect({
          onFailure: (failure) => offAfterFailure(flag, String(failure)),
          onSuccess: (details) =>
            details.errorCode === undefined
              ? Effect.succeed(details.value)
              : details.errorCode === MISSING_FLAG_ERROR_CODE
                ? Effect.succeed(OFF_WHEN_UNEVALUATED)
                : offAfterFailure(flag, details.errorCode),
        }),
      ),
  });
};

export const featureFlagsAllOff = (): Layer.Layer<FeatureFlags> =>
  Layer.succeed(FeatureFlags, { isOn: () => Effect.succeed(false) });
