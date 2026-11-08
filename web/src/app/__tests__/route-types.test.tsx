import { expect, test } from "bun:test";
import { getRouteApi, Link, redirect, type useNavigate } from "@tanstack/react-router";

const _missingPathLink = () => (
  // @ts-expect-error 存在しない path
  <Link to="/account/membrs" />
);

const _missingPathNavigate = (navigate: ReturnType<typeof useNavigate>) =>
  // @ts-expect-error 存在しない path
  navigate({ to: "/account/membrs" });

const _wrongSearchValue = () =>
  // @ts-expect-error search の redirect_url は文字列
  redirect({ to: "/account/members", search: { redirect_url: 1 } });

const _undeclaredKey = () =>
  // @ts-expect-error メンバー画面の search に error は宣言していない
  getRouteApi("/account/members").useSearch().error;

test("遷移先と search の型の probe は typecheck で機能する (runtime の検証は無い)", () => {
  expect(true).toBe(true);
});
