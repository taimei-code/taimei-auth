import { FEATURE_FLAGS_BINDING, flagshipFeatureFlags } from "../src/feature-flags";

export type FlagRules = {
  readonly enabled: boolean;
  readonly everyone: boolean;
  readonly companyIds: readonly string[];
};

export type FlagRulesStore = {
  readonly storedIn: "Memory" | "Database";
  readonly read: (flag: string) => Promise<FlagRules | undefined>;
  readonly update: (
    flag: string,
    next: (current: FlagRules | undefined) => FlagRules,
  ) => Promise<void>;
};

type FlagSwitchRequest =
  | { readonly flag: string; readonly state: "on" | "off" }
  | { readonly flag: string; readonly state: "onlyFor"; readonly companyIds: readonly string[] };

const RELEASED: FlagRules = { enabled: true, everyone: true, companyIds: [] };

const ruleMatches = (rules: FlagRules, context: Record<string, unknown>): boolean =>
  (typeof context.companyId === "string" && rules.companyIds.includes(context.companyId)) ||
  rules.everyone;

const memoryFlagRulesStore = (): FlagRulesStore => {
  const rulesByFlag = new Map<string, FlagRules>();
  return {
    storedIn: "Memory",
    read: async (flag) => rulesByFlag.get(flag),
    update: async (flag, next) => {
      rulesByFlag.set(flag, next(rulesByFlag.get(flag)));
    },
  };
};

export const fakeFlagship = (store: FlagRulesStore = memoryFlagRulesStore()) => {
  const removed = new Set<string>();
  let bindingFails = false;
  const rulesOf = async (flag: string) => (await store.read(flag)) ?? RELEASED;
  let switchedInOrder: Promise<void> = Promise.resolve();
  const switchTo = (flag: string, next: (current: FlagRules | undefined) => FlagRules) => {
    const switched = switchedInOrder.then(async () => {
      await store.update(flag, next);
      removed.delete(flag);
    });
    switchedInOrder = switched.catch(() => undefined);
    return switched;
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
      const rules = await rulesOf(flagKey);
      if (!rules.enabled) return { flagKey, value: defaultValue, reason: "DISABLED" };
      return ruleMatches(rules, context)
        ? { flagKey, value: true, reason: "TARGETING_MATCH" }
        : { flagKey, value: defaultValue, reason: "DEFAULT" };
    },
  };

  const on = (flag: string): Promise<void> => switchTo(flag, () => RELEASED);
  const off = (flag: string): Promise<void> =>
    switchTo(flag, (current) => ({ ...(current ?? RELEASED), enabled: false }));
  const onlyFor = (flag: string, companyIds: readonly string[]): Promise<void> =>
    switchTo(flag, () => ({ enabled: true, everyone: false, companyIds }));

  return {
    layer: flagshipFeatureFlags({ [FEATURE_FLAGS_BINDING]: binding }),
    storedIn: store.storedIn,
    on,
    off,
    onlyFor,
    switchFlag: (request: FlagSwitchRequest): Promise<void> =>
      request.state === "onlyFor"
        ? onlyFor(request.flag, request.companyIds)
        : { on, off }[request.state](request.flag),
    stateOf: async (flag: string) => {
      const rules = await rulesOf(flag);
      const status = !rules.enabled ? "Off" : rules.everyone ? "On" : "OnlyFor";
      return { status, companyIds: rules.companyIds } as const;
    },
    remove: (flag: string): void => {
      removed.add(flag);
    },
    breakBinding: (): void => {
      bindingFails = true;
    },
  };
};

export type FakeFlagship = ReturnType<typeof fakeFlagship>;
