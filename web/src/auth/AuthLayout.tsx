import { Outlet } from "@tanstack/react-router";
import { PhishingBanner } from "./PhishingBanner";

export const AuthLayout = () => {
  return (
    <>
      {import.meta.env.MODE === "production" && <PhishingBanner />}
      <Outlet />
    </>
  );
};
