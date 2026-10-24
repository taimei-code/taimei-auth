import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { type Context, Hono } from "hono";
import { listChoosableAccounts } from "../db/testing/dev-accounts";
import { InvalidArgument } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import { INVALID_REDIRECT_URL_PAGE, signInParamsSchema } from "../src/sign-in-params";
import { requireAuthHostOrigin } from "./auth-host-origin";
import { browserKeyIssuedIfMissing } from "./browser-key";
import { chosenAccountOf, pageAccountOf } from "./chosen-account";
import { nonProductionShell } from "./non-production-shell";
import { magicLinkUrlFor } from "./sent-links";

const ACCOUNT_PICKER_PATH = `${TESTING_PATH}/account-picker`;

const signInParamsOf = (c: Context) =>
  signInParamsSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

export const accountPickerRoutes = () =>
  new Hono()
    .get("/auth/", async (c, next) => {
      if (c.req.query("invitation_token") !== undefined) {
        await next();
        return c.res;
      }
      if (!signInParamsOf(c).success) return c.redirect(INVALID_REDIRECT_URL_PAGE, 302);
      return runRoute(
        c,
        Effect.promise(async () => {
          const { search } = new URL(c.req.url);
          return c.html(
            nonProductionShell({
              _tag: "AccountPicker",
              accounts: (await listChoosableAccounts(browserKeyIssuedIfMissing(c))).map(
                pageAccountOf,
              ),
              chooseAction: `${ACCOUNT_PICKER_PATH}${search}`,
              signUpHref: `/auth/signup${search}`,
            }),
          );
        }),
      );
    })
    .post(ACCOUNT_PICKER_PATH, requireAuthHostOrigin, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const params = signInParamsOf(c);
          if (!params.success) return yield* new InvalidArgument({});
          const user = yield* chosenAccountOf(c);
          return c.redirect(yield* magicLinkUrlFor(user.email, params.data.redirect_url), 303);
        }),
      ),
    );
