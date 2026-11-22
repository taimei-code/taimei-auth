type PasskeyProvider = Readonly<{ aaguid: string; name: string; source: `https://${string}` }>;

const WINDOWS_HELLO_SOURCE =
  "https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-authentication-entra-passkeys-on-windows";

export const PASSKEY_PROVIDERS: ReadonlyArray<PasskeyProvider> = [
  {
    aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
    name: "Google パスワードマネージャー",
    source: "https://web.dev/articles/webauthn-aaguid",
  },
  {
    aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
    name: "Chrome (Mac)",
    source: "https://developer.chrome.com/blog/passkeys-on-icloud-keychain",
  },
  {
    aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96",
    name: "Windows Hello",
    source: WINDOWS_HELLO_SOURCE,
  },
  {
    aaguid: "9ddd1817-af5a-4672-a2b9-3e3dd95000a9",
    name: "Windows Hello",
    source: WINDOWS_HELLO_SOURCE,
  },
  {
    aaguid: "6028b017-b1d4-4c02-b4b3-afcdafc96bb2",
    name: "Windows Hello",
    source: WINDOWS_HELLO_SOURCE,
  },
  {
    aaguid: "d548826e-79b4-db40-a3d8-11116f7e8349",
    name: "Bitwarden",
    source: "https://github.com/bitwarden/sdk-internal/blob/main/crates/bitwarden-fido/src/lib.rs",
  },
];

const PROVIDER_NAMES = new Map(PASSKEY_PROVIDERS.map(({ aaguid, name }) => [aaguid, name]));

export const passkeyProviderNameOf = (aaguid: string): string | null =>
  PROVIDER_NAMES.get(aaguid) ?? null;
