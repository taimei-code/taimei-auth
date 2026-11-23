import { FEATURE_FLAGS_BINDING, flagshipFeatureFlags } from "../src/feature-flags";

type Rules = {
  readonly enabled: boolean;
  readonly everyone: boolean;
  readonly companyIds: readonly string[];
};

type FlagSwitchRequest =
  | { readonly flag: string; readonly state: "on" | "off" }
  | { readonly flag: string; readonly state: "onlyFor"; readonly companyIds: readonly string[] };

const RELEASED: Rules = { enabled: true, everyone: true, companyIds: [] };

const ruleMatches = (rules: Rules, context: Record<string, unknown>): boolean =>
  (typeof context.companyId === "string" && rules.companyIds.includes(context.companyId)) ||
  rules.everyone;

export const fakeFlagship = () => {
  const rulesByFlag = new Map<string, Rules>();
  const removed = new Set<string>();
  let bindingFails = false;
  const rulesOf = (flag: string) => rulesByFlag.get(flag) ?? RELEASED;
  const switchTo = (flag: string, rules: Rules) => {
    removed.delete(flag);
    rulesByFlag.set(flag, rules);
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
      const rules = rulesOf(flagKey);
      if (!rules.enabled) return { flagKey, value: defaultValue, reason: "DISABLED" };
      return ruleMatches(rules, context)
        ? { flagKey, value: true, reason: "TARGETING_MATCH" }
        : { flagKey, value: defaultValue, reason: "DEFAULT" };
    },
  };

  const on = (flag: string): void => switchTo(flag, RELEASED);
  const off = (flag: string): void => switchTo(flag, { ...rulesOf(flag), enabled: false });
  const onlyFor = (flag: string, companyIds: readonly string[]): void =>
    switchTo(flag, { enabled: true, everyone: false, companyIds });

  return {
    layer: flagshipFeatureFlags({ [FEATURE_FLAGS_BINDING]: binding }),
    on,
    off,
    onlyFor,
    switchFlag: (request: FlagSwitchRequest): void =>
      request.state === "onlyFor"
        ? onlyFor(request.flag, request.companyIds)
        : { on, off }[request.state](request.flag),
    stateOf: (flag: string) => {
      const rules = rulesOf(flag);
      const status = !rules.enabled ? "Off" : rules.everyone ? "On" : "OnlyFor";
      return { status, companyIds: rules.companyIds } as const;
    },
    remove: (flag: string): void => {
      rulesByFlag.delete(flag);
      removed.add(flag);
    },
    breakBinding: (): void => {
      bindingFails = true;
    },
  };
};

export type FakeFlagship = ReturnType<typeof fakeFlagship>;
