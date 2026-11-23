import type { FeatureFlag, FeatureFlagRegistry, FlagAudience } from "../src/feature-flags";

export type FeatureFlagCatalog = Readonly<Record<string, FlagAudience>>;

export type RegisteredFlagCatalog = { readonly [F in FeatureFlag]: FeatureFlagRegistry[F] };

export const FEATURE_FLAG_CATALOG = {
  passkey: "everyone",
} as const satisfies RegisteredFlagCatalog;
