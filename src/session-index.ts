import { Option, Schema } from "effect";

const SessionIndexEntry = Schema.Struct({ token: Schema.String, expiresAt: Schema.Finite });
type SessionIndexEntry = typeof SessionIndexEntry.Type;

const decodeStoredItems = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);
const decodeEntry = Schema.decodeUnknownOption(SessionIndexEntry);

export type MergedSessionIndex = { readonly value: string; readonly ttlSeconds: number };

const entriesOf = (raw: string | null): SessionIndexEntry[] =>
  Option.getOrElse(decodeStoredItems(raw ?? "[]"), () => []).flatMap((item) =>
    Option.toArray(decodeEntry(item)),
  );

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
