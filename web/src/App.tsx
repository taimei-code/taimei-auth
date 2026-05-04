import { BrowserRouter, Routes, Route } from "react-router-dom";

import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { ErrorPage } from "./pages/Error";
import { AccountLayout } from "./components/account/AccountLayout";
import { AccountIndex } from "./pages/account/Index";
import { Security } from "./pages/account/Security";
import { Sessions } from "./pages/account/Sessions";
import { Connections } from "./pages/account/Connections";
import { SessionGuard } from "./lib/session-guard";

// Layer B Router: /auth/* と /account/* の 2 系統を 1 つの SPA で扱う。basename は使わず
// Routes に絶対パス指定。Vite base="/auth/" は asset URL prefix のためで Router path とは独立 —
// /account 訪問時もブラウザは /auth/assets/* を fetch し Hono の /auth/* serveStatic で配信される。
//
// /verify-magic-link は Better Auth 標準の /api/auth/magic-link/verify が token verify + callbackURL
// redirect を完結させるため、Layer B 側に UI ルートは不要 (plan の項目4 から撤廃)。
//
// /account/* は SessionGuard で Cookie 検証 → AccountLayout で sidebar nav + Outlet。
// PR8b で /security, /sessions, /connections のサブルートを追加予定。
export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<SignIn />} />
        <Route path="/auth/signup" element={<SignUp />} />
        <Route path="/auth/error" element={<ErrorPage />} />

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
