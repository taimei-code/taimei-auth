import { Outlet } from "react-router-dom";
import { PhishingBanner } from "./PhishingBanner";

// /auth/* route の layout。production build のみ PhishingBanner を render する
// (URL 詐称対策、local dev では非表示で開発 UX を阻害しない)。
// app/AccountLayout の pattern と整合。
export const AuthLayout = () => {
  return (
    <>
      {import.meta.env.MODE === "production" && <PhishingBanner />}
      <Outlet />
    </>
  );
};
