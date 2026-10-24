import { validateRedirectUrl } from "../src/url-allowlist";
console.log(JSON.stringify({
  localhost: validateRedirectUrl("http://localhost:3110/account", "accounts"),
  devHost: validateRedirectUrl("http://auth.taimei-code.localhost:3100/account", "accounts"),
  production: validateRedirectUrl("https://auth.taimei-code.com/account", "accounts"),
}));
