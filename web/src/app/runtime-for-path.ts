const FOLDKIT_AUTH_PATHS: ReadonlyArray<string> = ["/auth/error"];

export type RuntimeForPath = "FoldkitAuth" | "FoldkitAccount" | "React";

const isAccountPath = (pathname: string) =>
  pathname === "/account" || pathname.startsWith("/account/");

export const runtimeForPath = (pathname: string): RuntimeForPath => {
  if (FOLDKIT_AUTH_PATHS.includes(pathname)) return "FoldkitAuth";
  return isAccountPath(pathname) ? "FoldkitAccount" : "React";
};
