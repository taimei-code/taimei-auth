import { href, Link, useNavigate } from "react-router";
import type { Route } from "./+types/members";

export default function Members(_: Route.ComponentProps) {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(href("/auth/error"))}>ok</button>
      <Link to={href("/account/members")}>ok</Link>
    </>
  );
}
