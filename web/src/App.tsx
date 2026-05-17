import { BrowserRouter, Routes, Route } from "react-router-dom";

import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { ErrorPage } from "./pages/Error";
import { AuthLayout } from "./components/auth/AuthLayout";
import { AccountLayout } from "./components/account/AccountLayout";
import { AccountIndex } from "./pages/account/Index";
import { Security } from "./pages/account/Security";
import { Sessions } from "./pages/account/Sessions";
import { Connections } from "./pages/account/Connections";
import { SessionGuard } from "./lib/session-guard";

// /auth/* と /account/* を 1 SPA で扱う。Vite base="/auth/" は asset URL prefix のみで Router path とは独立。
// 詳細: docs/adr/0002-spa-routing-and-static-assets.md
export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthLayout />}>
          <Route index element={<SignIn />} />
          <Route path="signup" element={<SignUp />} />
          <Route path="error" element={<ErrorPage />} />
        </Route>

        <Route
          path="/account"
          element={
            <SessionGuard>
              <AccountLayout />
            </SessionGuard>
          }
        >
          <Route index element={<AccountIndex />} />
          <Route path="security" element={<Security />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="connections" element={<Connections />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
