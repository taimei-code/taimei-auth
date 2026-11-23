import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client/cookie";

export const sessionCookieOf = (headers: Headers): string | undefined =>
  extractSessionTokenFromCookieHeader(headers.get("cookie") ?? "");

const percentDecoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const sessionTokenAsBetterAuthReads = (headers: Headers): string | undefined => {
  const raw = sessionCookieOf(headers);
  if (raw === undefined) return undefined;
  const value = percentDecoded(raw.startsWith('"') ? raw.slice(1, -1) : raw);
  const signatureStart = value.lastIndexOf(".");
  return (signatureStart < 1 ? value : value.slice(0, signatureStart)) || undefined;
};
