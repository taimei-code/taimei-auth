import { href, Link, useNavigate } from "react-router";
import type { Route as SignInRoute } from "./routes/+types/sign-in";

export const M3Probe = ({ loaderData }: SignInRoute.ComponentProps) => {
  const serviceName: "taimei" | "accounts" = loaderData.service_name;
  // @ts-expect-error M3: 宣言していない key は読めない
  loaderData.unknown_key;
  return <p>{serviceName}</p>;
};

export const M4Probe = () => {
  const navigate = useNavigate();
  // @ts-expect-error M4: href は存在しない path を拒む
  href("/account/membrs");
  // @ts-expect-error M4: reason に定義されていない値 (search は href の引数に無い)
  void navigate(`${href("/auth/error")}?reason=bogus`);
  // @ts-expect-error M4: href を通さない path の typo
  void navigate("/account/membrs");
  return (
    <>
      {/* @ts-expect-error M4: Link の to は文字列 */}
      <Link to="/account/membrs">ng</Link>
    </>
  );
};
