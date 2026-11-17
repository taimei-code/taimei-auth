import { signInParamsSchema } from "@core/sign-in-params";
import type { Route } from "./+types/sign-in";

export const clientLoader = ({ request }: Route.ClientLoaderArgs) =>
  signInParamsSchema.parse(Object.fromEntries(new URL(request.url).searchParams));

export default function SignIn({ loaderData }: Route.ComponentProps) {
  return <p>{loaderData.service_name}{loaderData.redirect_url}</p>;
}
