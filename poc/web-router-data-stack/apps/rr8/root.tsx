import { Outlet, Scripts } from "react-router";

export default function Root() {
  return (
    <html lang="ja">
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
