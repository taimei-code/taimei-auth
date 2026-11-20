import type { Layer } from "effect";
import type { FeatureFlags } from "../../src/feature-flags";

type FlagRules = {
  readonly enabled: boolean;
  readonly listedCompanies: readonly string[];
  readonly everyone: boolean;
};

type Details = {
  readonly flagKey: string;
  readonly value: boolean;
  readonly reason: string;
  readonly errorCode?: string;
};

type Context = Record<string, unknown>;

const RELEASED: FlagRules = { enabled: true, listedCompanies: [], everyone: true };

const ruleMatches = (rules: FlagRules, context: Context): boolean =>
  rules.listedCompanies.some((companyId) => companyId === context.companyId) || rules.everyone;

export const fakeFlagship = () => {
  const flags = new Map<string, FlagRules>();
  let bindingFails = false;

  const details = async (
    flagKey: string,
    defaultValue: boolean,
    context: Context = {},
  ): Promise<Details> => {
    if (bindingFails) throw new Error("flagship is unavailable");
    const rules = flags.get(flagKey);
    if (rules === undefined) {
      return { flagKey, value: defaultValue, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" };
    }
    if (!rules.enabled) return { flagKey, value: defaultValue, reason: "DISABLED" };
    return ruleMatches(rules, context)
      ? { flagKey, value: true, reason: "TARGETING_MATCH" }
      : { flagKey, value: defaultValue, reason: "DEFAULT" };
  };

  const binding = {
    getBooleanDetails: details,
    getBooleanValue: async (flagKey: string, defaultValue: boolean, context?: Context) =>
      (await details(flagKey, defaultValue, context)).value,
    get: async (flagKey: string, defaultValue?: unknown, context?: Context) =>
      (await details(flagKey, defaultValue === true, context)).value,
  };

  return {
    on: (flag: string) => {
      flags.set(flag, RELEASED);
    },
    off: (flag: string) => {
      flags.set(flag, { ...(flags.get(flag) ?? RELEASED), enabled: false });
    },
    onlyFor: (flag: string, companyIds: readonly string[]) => {
      flags.set(flag, { enabled: true, listedCompanies: companyIds, everyone: false });
    },
    breakBinding: () => {
      bindingFails = true;
    },
    layer: async (): Promise<Layer.Layer<FeatureFlags>> => {
      const { FEATURE_FLAGS_BINDING, flagshipFeatureFlags } = await import(
        "../../src/feature-flags"
      );
      return flagshipFeatureFlags({ [FEATURE_FLAGS_BINDING]: binding } as never);
    },
  };
};

export type FakeFlagship = ReturnType<typeof fakeFlagship>;
