import { z } from "zod";
import type { Route } from "./+types/error";

const searchSchema = z.object({
  reason: z.enum(["invalid_redirect_url", "signup_already_completed", "signin_failed", "default"]).optional().catch(undefined),
});

export const clientLoader = ({ request }: Route.ClientLoaderArgs) =>
  searchSchema.parse(Object.fromEntries(new URL(request.url).searchParams));

export default function ErrorPage({ loaderData }: Route.ComponentProps) {
  return <p>{loaderData.reason ?? "default"}</p>;
}
