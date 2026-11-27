import { FEATURE_FLAGS_BINDING, flagshipFeatureFlags } from "../src/feature-flags";

type FlagRules = {
  readonly enabled: boolean;
  readonly everyone: boolean;
  readonly companyIds: readonly string[];
};

type FlagSwitchRequest =
  | { readonly flag: string; readonly state: "on" | "off" }
  | { readonly flag: string; readonly state: "onlyFor"; readonly companyIds: readonly string[] };

const RELEASED: FlagRules = { enabled: true, everyone: true, companyIds: [] };

const ruleMatches = (rules: FlagRules, context: Record<string, unknown>): boolean =>
  (typeof context.companyId === "string" && rules.companyIds.includes(context.companyId)) ||
  rules.everyone;

export const fakeFlagship = () => {
  const rulesByFlag = new Map<string, FlagRules>();
  const removed = new Set<string>();
  let bindingFails = false;
  const switchTo = async (flag: string, rules: FlagRules): Promise<void> => {
    rulesByFlag.set(flag, rules);
    removed.delete(flag);
  };

  const binding = {
    getBooleanDetails: async (
      flagKey: string,
      defaultValue: boolean,
      context: Record<string, unknown> = {},
    ) => {
      if (bindingFails) throw new Error("flagship is unavailable");
      if (removed.has(flagKey)) {
        return { flagKey, value: defaultValue, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" };
      }
      const rules = rulesByFlag.get(flagKey) ?? RELEASED;
      if (!rules.enabled) return { flagKey, value: defaultValue, reason: "DISABLED" };
      return ruleMatches(rules, context)
        ? { flagKey, value: true, reason: "TARGETING_MATCH" }
        : { flagKey, value: defaultValue, reason: "DEFAULT" };
    },
  };

  const on = (flag: string): Promise<void> => switchTo(flag, RELEASED);
  const off = (flag: string): Promise<void> => switchTo(flag, { ...RELEASED, enabled: false });
  const onlyFor = (flag: string, companyIds: readonly string[]): Promise<void> =>
    switchTo(flag, { enabled: true, everyone: false, companyIds });

  return {
    layer: flagshipFeatureFlags({ [FEATURE_FLAGS_BINDING]: binding }),
    on,
    off,
    onlyFor,
    switchFlag: (request: FlagSwitchRequest): Promise<void> =>
      request.state === "onlyFor"
        ? onlyFor(request.flag, request.companyIds)
        : { on, off }[request.state](request.flag),
    remove: (flag: string): void => {
      removed.add(flag);
    },
    breakBinding: (): void => {
      bindingFails = true;
    },
  };
};

export type FakeFlagship = ReturnType<typeof fakeFlagship>;
