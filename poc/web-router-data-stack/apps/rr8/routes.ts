import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("auth", "routes/sign-in.tsx"),
  route("auth/error", "routes/error.tsx"),
  route("account/members", "routes/members.tsx"),
] satisfies RouteConfig;
