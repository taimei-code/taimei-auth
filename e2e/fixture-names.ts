export const CONSUMABLE_FIXTURES = [
  "leave",
  "delete",
  "delete-multi",
  "invitation",
  "mfa",
  "switch",
  "withdraw",
] as const;

export type ConsumableFixture = (typeof CONSUMABLE_FIXTURES)[number];

export const isConsumableFixture = (name: string): name is ConsumableFixture =>
  (CONSUMABLE_FIXTURES as readonly string[]).includes(name);
