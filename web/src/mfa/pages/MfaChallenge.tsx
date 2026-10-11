import { getRouteApi } from "@tanstack/react-router";

import { MfaChallengeView } from "../MfaChallengeView";
import { useMfaChallengeFlow } from "../use-mfa-challenge-flow";

const route = getRouteApi("/auth/mfa");

export const MfaChallenge = () => (
  <MfaChallengeView {...useMfaChallengeFlow(route.useLoaderData())} />
);
