const FOLDKIT_AUTH_PATHS: ReadonlyArray<string> = [
  "/auth",
  "/auth/signup",
  "/auth/signup/company",
  "/auth/signup/accept-invitation",
  "/auth/mfa",
  "/auth/error",
];

export type RuntimeForPath = "FoldkitAuth" | "FoldkitAccount" | "React";

const isAccountPath = (pathname: string) =>
  pathname === "/account" || pathname.startsWith("/account/");

export const runtimeForPath = (pathname: string): RuntimeForPath => {
  if (FOLDKIT_AUTH_PATHS.includes(pathname.replace(/\/+$/, ""))) {
    return "FoldkitAuth";
  } else if (isAccountPath(pathname)) {
    return "FoldkitAccount";
  } else {
    return "React";
  }
};
