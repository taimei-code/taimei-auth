import { expect, test } from "bun:test";
import { getRouteApi, Link, redirect, type useNavigate } from "@tanstack/react-router";

const _missingPathLink = () => (
  // @ts-expect-error 存在しない path
  <Link to="/account/membrs" />
);

const _missingPathNavigate = (navigate: ReturnType<typeof useNavigate>) =>
  // @ts-expect-error 存在しない path
  navigate({ to: "/account/membrs" });

const _undefinedReason = () =>
  // @ts-expect-error 定義外の reason
  redirect({ to: "/auth/error", search: { reason: "bogus" } });

const _missingRedirectUrl = () =>
  // @ts-expect-error 必須の redirect_url が無い
  redirect({ to: "/auth", search: { service_name: "accounts" } });

const _undeclaredKey = () =>
  // @ts-expect-error sign-in の search に error は宣言していない
  getRouteApi("/auth/").useSearch().error;

test("遷移先と search の型の probe は typecheck で機能する (runtime の検証は無い)", () => {
  expect(true).toBe(true);
});
