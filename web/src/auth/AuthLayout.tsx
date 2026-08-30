import { Outlet } from "react-router-dom";
import { PhishingBanner } from "./PhishingBanner";

// /auth/* route の layout。PhishingBanner は production build のみ render する (local dev では非表示)。
export const AuthLayout = () => {
  return (
    <>
      {import.meta.env.MODE === "production" && <PhishingBanner />}
      <Outlet />
    </>
  );
};
