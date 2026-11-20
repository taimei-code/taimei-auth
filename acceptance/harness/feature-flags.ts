import type { FakeFlagship } from "../../testing/feature-flags";

export type { FakeFlagship };

export const loadFakeFlagship = async (): Promise<FakeFlagship> =>
  (await import("../../testing/feature-flags")).fakeFlagship();
