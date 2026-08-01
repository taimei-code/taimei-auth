import { BrowserRouter, Routes, Route } from "react-router-dom";

import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { SignUpCompany } from "./pages/SignUpCompany";
import { SignUpAcceptInvitation } from "./pages/SignUpAcceptInvitation";
import { ErrorPage } from "./pages/Error";
import { AuthLayout } from "./components/auth/AuthLayout";
import { AccountLayout } from "./components/account/AccountLayout";
import { AccountIndex } from "./pages/account/Index";
import { Companies } from "./pages/account/Companies";
import { CompanySettings } from "./pages/account/CompanySettings";
import { Members } from "./pages/account/Members";
import { Security } from "./pages/account/Security";
import { Sessions } from "./pages/account/Sessions";
import { Connections } from "./pages/account/Connections";
import { CompanyProvider } from "./lib/company-context";
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
          <Route path="signup/company" element={<SignUpCompany />} />
          <Route path="signup/accept-invitation" element={<SignUpAcceptInvitation />} />
          <Route path="error" element={<ErrorPage />} />
        </Route>

        {/* CompanyProvider を SessionGuard の外に置き、guard の認証判定と layout 配下の
            事業所 state が同じ 1 回の memberships fetch を共有する (二重 fetch 防止)。 */}
        <Route
          path="/account"
          element={
            <CompanyProvider>
              <SessionGuard>
                <AccountLayout />
              </SessionGuard>
            </CompanyProvider>
          }
        >
          <Route index element={<AccountIndex />} />
          <Route path="companies" element={<Companies />} />
          <Route path="company-settings" element={<CompanySettings />} />
          <Route path="members" element={<Members />} />
          <Route path="security" element={<Security />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="connections" element={<Connections />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
