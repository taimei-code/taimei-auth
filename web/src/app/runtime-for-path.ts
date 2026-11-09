export type RuntimeForPath = "FoldkitAuth" | "FoldkitAccount";

const isAccountPath = (pathname: string) =>
  pathname === "/account" || pathname.startsWith("/account/");

export const runtimeForPath = (pathname: string): RuntimeForPath =>
  isAccountPath(pathname) ? "FoldkitAccount" : "FoldkitAuth";
