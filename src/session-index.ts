import { z } from "zod";

const sessionIndexEntry = z.object({ token: z.string(), expiresAt: z.number() });

export type MergedSessionIndex = { readonly value: string; readonly ttlSeconds: number };

const entriesOf = (raw: string | null): z.infer<typeof sessionIndexEntry>[] => {
  try {
    const parsed = z.array(z.unknown()).safeParse(JSON.parse(raw ?? "[]")).data ?? [];
    return parsed.flatMap((item) => sessionIndexEntry.safeParse(item).data ?? []);
  } catch {
    return [];
  }
};

export const mergeSessionIndex = (
  stored: string | null,
  incoming: string,
  now: number,
): MergedSessionIndex => {
  const written = entriesOf(incoming);
  const writtenTokens = new Set(written.map(({ token }) => token));
  const keptFromStored = entriesOf(stored).filter(
    ({ token, expiresAt }) => !writtenTokens.has(token) && expiresAt > now,
  );
  const merged = [...keptFromStored, ...written].sort((a, b) => a.expiresAt - b.expiresAt);
  const latest = merged.at(-1)?.expiresAt ?? now;
  return {
    value: JSON.stringify(merged),
    ttlSeconds: Math.max(0, Math.ceil((latest - now) / 1000)),
  };
};
