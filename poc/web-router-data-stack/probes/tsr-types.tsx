import { getRouteApi, Link, redirect, useNavigate } from "@tanstack/react-router";
import "../apps/tsr-atom/routes";

const signIn = getRouteApi("/auth");
const errorApi = getRouteApi("/auth/error");

export const M3Probe = () => {
  const search = signIn.useSearch();
  const serviceName: "taimei" | "accounts" = search.service_name;
  const redirectUrl: string = search.redirect_url;
  // @ts-expect-error M3: 宣言していない key は読めない
  search.unknown_key;
  const { reason } = errorApi.useSearch();
  const typedReason: "invalid_redirect_url" | "signup_already_completed" | "signin_failed" | "default" | undefined = reason;
  return <p>{serviceName}{redirectUrl}{typedReason}</p>;
};

export const M4Probe = () => {
  const navigate = useNavigate();
  void navigate({ to: "/auth/error", search: { reason: "signin_failed" } });
  // @ts-expect-error M4: reason に定義されていない値
  void navigate({ to: "/auth/error", search: { reason: "bogus" } });
  // @ts-expect-error M4: 存在しない path
  void navigate({ to: "/account/membrs" });
  // @ts-expect-error M4: 必須の redirect_url が無い
  redirect({ to: "/auth", search: { service_name: "accounts" } });
  return (
    <>
      <Link to="/account/members">ok</Link>
      {/* @ts-expect-error M4: 存在しない path の Link */}
      <Link to="/account/membrs">ng</Link>
    </>
  );
};
