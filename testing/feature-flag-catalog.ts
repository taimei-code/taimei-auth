import type { FeatureFlag, FeatureFlagRegistry } from "../src/feature-flags";

export type RegisteredFlagCatalog = { readonly [F in FeatureFlag]: FeatureFlagRegistry[F] };

export const FEATURE_FLAG_CATALOG = {
  passkey: "everyone",
} as const satisfies RegisteredFlagCatalog;
