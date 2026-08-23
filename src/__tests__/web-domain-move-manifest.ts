import type { MoveManifestEntry, RawManifestEntry } from "./web-domain-structure-helpers";

// Historical paths below are an intentional AC-142 baseline witness, not live imports.
export const WEB_DOMAIN_BASELINE_HEAD = "91dde8ae421a18621a049f0a3692abf5f89861f4";

export const WEB_DOMAIN_MOVE_MANIFEST = [
  {
    baselinePath: "web/src/components/CanaryTokens.tsx",
    currentPath: "web/src/auth/CanaryTokens.tsx",
    normalizedSha256: "7057b2af74b08d3cdf8954627833b5e85134dfd199bed2931da0b06b87f95213",
  },
  {
    baselinePath: "web/src/components/ConfirmDestructiveDialog.tsx",
    currentPath: "web/src/shared/ConfirmDestructiveDialog.tsx",
    normalizedSha256: "8493d579437ed08b412693f9ef455d520542e0ec7441dd3a6d7d685effac82fd",
  },
  {
    baselinePath: "web/src/components/FullScreenLoader.tsx",
    currentPath: "web/src/shared/FullScreenLoader.tsx",
    normalizedSha256: "241feb5bcb481860515ce953aedb5d7340aa34a8813517ec65f7f0abf5c471f6",
  },
  {
    baselinePath: "web/src/components/PhishingBanner.tsx",
    currentPath: "web/src/auth/PhishingBanner.tsx",
    normalizedSha256: "22138d3a39752c824e8f0331459011a80a7368423bfcb0f58ac7751e130c500a",
  },
  {
    baselinePath: "web/src/components/account/AccountLayout.tsx",
    currentPath: "web/src/app/AccountLayout.tsx",
    normalizedSha256: "7cf475e92cf49bd26e2837ec00eea7059f0117e523fe61ea0e339b0886af009f",
  },
  {
    baselinePath: "web/src/components/account/AddCompanyDialog.tsx",
    currentPath: "web/src/company/AddCompanyDialog.tsx",
    normalizedSha256: "a60568005c493bcd35a2ade99e06b0788c07411bc75f9295dbd6219d7faf1000",
  },
  {
    baselinePath: "web/src/components/account/AvatarUploader.tsx",
    currentPath: "web/src/account/AvatarUploader.tsx",
    normalizedSha256: "477f71b5e2eb8fae401f4823154c98eed1440fac84889e34c9cccc6a6ef2879e",
  },
  {
    baselinePath: "web/src/components/account/DangerZone.tsx",
    currentPath: "web/src/account/DangerZone.tsx",
    normalizedSha256: "05b5d291dc63a3d9211ffeea6ff43ac687f0fd4a49a972e552a7258fdd943f12",
  },
  {
    baselinePath: "web/src/components/account/MfaDisableDialog.tsx",
    currentPath: "web/src/mfa/MfaDisableDialog.tsx",
    normalizedSha256: "d1dd7dfcf9f73283177b1fa490d23a30ad5bc05ee98ce9cb751906d3d8c4cfd6",
  },
  {
    baselinePath: "web/src/components/account/MfaEnrollDialog.tsx",
    currentPath: "web/src/mfa/MfaEnrollDialog.tsx",
    normalizedSha256: "6be3456c45d31097bf0fddcae8aacd5f89e5059c8058b4d10060f909666e952d",
  },
  {
    baselinePath: "web/src/components/account/ProfileForm.tsx",
    currentPath: "web/src/account/ProfileForm.tsx",
    normalizedSha256: "be3cac762a1cb499927dc8cd116a1238244c8e48fdaf8452959ba7b58a0ef601",
  },
  {
    baselinePath: "web/src/components/account/SignOutButton.tsx",
    currentPath: "web/src/auth/SignOutButton.tsx",
    normalizedSha256: "605e0768d63d7e9ca3974accbdb396be1177198de0adba7fbfa5ed4d471b313c",
  },
  {
    baselinePath: "web/src/components/account/TransferOwnershipModal.tsx",
    currentPath: "web/src/membership/TransferOwnershipModal.tsx",
    normalizedSha256: "7c5b1289570706c88dcf3971ceb10cb1a491052b38408889066324a8360ea61d",
  },
  {
    baselinePath: "web/src/components/auth/AuthLayout.tsx",
    currentPath: "web/src/auth/AuthLayout.tsx",
    normalizedSha256: "0e79d155ef7c40e8df55323288a1e0f6c0a3b725a2a865d432d647c22b9fb838",
  },
  {
    baselinePath: "web/src/components/auth/SocialSignInSection.tsx",
    currentPath: "web/src/auth/SocialSignInSection.tsx",
    normalizedSha256: "b2501842a33f8a820ebe89c8eeae9c21930955f341b5c9db7e944aea6f58013d",
  },
  {
    baselinePath: "web/src/components/notify.tsx",
    currentPath: "web/src/shared/notify.tsx",
    normalizedSha256: "fe4c4c0385b7156b26d1c28182232348041410b94630052f2abe528ad080b329",
  },
  {
    baselinePath: "web/src/components/ui/alert.tsx",
    currentPath: "web/src/shared/ui/alert.tsx",
    normalizedSha256: "60f3a52d4dd904363475b0ab9b5ee71c2e8f11d16bc672fcaac8a1c751ccc306",
  },
  {
    baselinePath: "web/src/components/ui/avatar.tsx",
    currentPath: "web/src/shared/ui/avatar.tsx",
    normalizedSha256: "58b4b8b89d23fce037cd0815d62ddd272bbbd2266440df30416edd490294fe4e",
  },
  {
    baselinePath: "web/src/components/ui/badge.tsx",
    currentPath: "web/src/shared/ui/badge.tsx",
    normalizedSha256: "8d8c7c60c4144f55a07a35068dd004b1501fd6f9a848f4966d961d8df70f3520",
  },
  {
    baselinePath: "web/src/components/ui/button.tsx",
    currentPath: "web/src/shared/ui/button.tsx",
    normalizedSha256: "95507ebc09fb358301c975729a268e397058995b282721f3920324bac1432aa8",
  },
  {
    baselinePath: "web/src/components/ui/card.tsx",
    currentPath: "web/src/shared/ui/card.tsx",
    normalizedSha256: "d1f5074df95c8b882c3f59c0dfc124d0e3b69a39d0704d66bcf24692dffb38fb",
  },
  {
    baselinePath: "web/src/components/ui/dialog.tsx",
    currentPath: "web/src/shared/ui/dialog.tsx",
    normalizedSha256: "c228a0456191883b0c96a50d88e52c0b9dc8ec6bf25bf846bbeb634a719fa49c",
  },
  {
    baselinePath: "web/src/components/ui/input.tsx",
    currentPath: "web/src/shared/ui/input.tsx",
    normalizedSha256: "17a4958834e2e632ea4aeb7f0baff02b0106c6fbbd3ccf24dcdd54e04abbecf5",
  },
  {
    baselinePath: "web/src/components/ui/label.tsx",
    currentPath: "web/src/shared/ui/label.tsx",
    normalizedSha256: "8281f9599e6a38d0d0d0d3bc2e59525301b682041b8a792ac773fe628a06c07c",
  },
  {
    baselinePath: "web/src/components/ui/native-select.tsx",
    currentPath: "web/src/shared/ui/native-select.tsx",
    normalizedSha256: "f4544fcd44a7ab2b865fdceb86db062ee0d45ff926540e46b4100d64faaae876",
  },
  {
    baselinePath: "web/src/components/ui/separator.tsx",
    currentPath: "web/src/shared/ui/separator.tsx",
    normalizedSha256: "1370ac495794abe09561174c8550240687706a587d2bff23663c705b7b5102d0",
  },
  {
    baselinePath: "web/src/lib/__tests__/auth-redirect.test.ts",
    currentPath: "web/src/auth/__tests__/auth-redirect.test.ts",
    normalizedSha256: "23e8b6bc8648b78ecc1e362a7cf9afcac1c62bbba2ec28be6299c3e8ba750f7e",
  },
  {
    baselinePath: "web/src/lib/__tests__/mfa-api.test.ts",
    currentPath: "web/src/mfa/__tests__/mfa-api.test.ts",
    normalizedSha256: "08cddac126ed179a77c487f1b3f27c986813f8a1eab38474e77003c1f1a4eecd",
  },
  {
    baselinePath: "web/src/lib/__tests__/mfa-challenge-flow.test.ts",
    currentPath: "web/src/mfa/__tests__/mfa-challenge-flow.test.ts",
    normalizedSha256: "e7479819853358f1e07b7ea581a33d3118ac17da2d3f116843677186dbfb56fd",
  },
  {
    baselinePath: "web/src/lib/__tests__/mfa-code-entry.test.ts",
    currentPath: "web/src/mfa/__tests__/mfa-code-entry.test.ts",
    normalizedSha256: "64e44011af85a92c07eeb13cf3736444296167724007b62ace9ffb7a8da467f1",
  },
  {
    baselinePath: "web/src/lib/__tests__/sign-params.test.ts",
    currentPath: "web/src/auth/__tests__/sign-params.test.ts",
    normalizedSha256: "6474c0c6c2872181ee28f85c1fc153e2731900aa9eafeb40bf416895e419aa1b",
  },
  {
    baselinePath: "web/src/lib/__tests__/use-mfa-challenge-flow.test.ts",
    currentPath: "web/src/mfa/__tests__/use-mfa-challenge-flow.test.ts",
    normalizedSha256: "1d34c818593c0eba1d7767401e6747c422453fb170b55d2f93395c1235bddb57",
  },
  {
    baselinePath: "web/src/lib/auth-client.ts",
    currentPath: "web/src/auth/auth-client.ts",
    normalizedSha256: "3b8db1ead4a0a9e5863dfa10a796a62c4d599f6af3f00063992ef9f9d869f4e5",
  },
  {
    baselinePath: "web/src/lib/auth-redirect.ts",
    currentPath: "web/src/auth/auth-redirect.ts",
    normalizedSha256: "9690070ea24fdeec16b5a1e7a1839ea262a6679e7c290ca8d3eb0011ff1f1bad",
  },
  {
    baselinePath: "web/src/lib/mfa-api.ts",
    currentPath: "web/src/mfa/mfa-api.ts",
    normalizedSha256: "a3569e2578523566632baed72ef2d416f66d524c10125c30bb53e6a93bd9649e",
  },
  {
    baselinePath: "web/src/lib/mfa-challenge-flow.ts",
    currentPath: "web/src/mfa/mfa-challenge-flow.ts",
    normalizedSha256: "21cc510a1960f3642a4d7b4b70c020c0f35fbafe20663ea68c92853fcb2d2313",
  },
  {
    baselinePath: "web/src/lib/sign-params.ts",
    currentPath: "web/src/auth/sign-params.ts",
    normalizedSha256: "e19a13fb3468d343a86cd61d4715163ac76b5ed438ad087268bce3f0ac21f009",
  },
  {
    baselinePath: "web/src/lib/use-async-load.ts",
    currentPath: "web/src/shared/use-async-load.ts",
    normalizedSha256: "ff2aea60af370d448c53d27fddce67992ce090fa3d6a71145b065be39b319c96",
  },
  {
    baselinePath: "web/src/lib/use-mfa-challenge-flow.ts",
    currentPath: "web/src/mfa/use-mfa-challenge-flow.ts",
    normalizedSha256: "9fe6ec13a9f6d7fd22b1ef730c3a07f6895b10ae12f368637506bb7ff29235a2",
  },
  {
    baselinePath: "web/src/lib/use-mfa-code-entry.ts",
    currentPath: "web/src/mfa/use-mfa-code-entry.ts",
    normalizedSha256: "1c8b3627cf95bc0caf12be953f2254355ba2af985ac31902923dbdef9e69b2a0",
  },
  {
    baselinePath: "web/src/lib/use-sign-page.ts",
    currentPath: "web/src/auth/use-sign-page.ts",
    normalizedSha256: "0b16a9d4c4dd791f726fc2346df9797e31c3fed80ea84d7deafd73be48176f14",
  },
  {
    baselinePath: "web/src/lib/utils.ts",
    currentPath: "web/src/shared/utils.ts",
    normalizedSha256: "13ab1f7404ffd28aafc426badb9180a699dc9cc8be3fb83747f53918d5c4c49b",
  },
  {
    baselinePath: "web/src/main.tsx",
    currentPath: "web/src/main.tsx",
    normalizedSha256: "f03d08ae1b82d4329ec3ff9bc6c7270488aafb23ecfb5e1530e643998d0100c2",
  },
  {
    baselinePath: "web/src/pages/Error.tsx",
    currentPath: "web/src/auth/pages/Error.tsx",
    normalizedSha256: "c92e27f3a5a772f057132876d55e8c394f270a686b506145f40316efa0fca532",
  },
  {
    baselinePath: "web/src/pages/MfaChallenge.tsx",
    currentPath: "web/src/mfa/pages/MfaChallenge.tsx",
    normalizedSha256: "dd3f3c88b3fdbc706bbd1039082b805403d10e7caf0c3fbb1d3d89494b768f5c",
  },
  {
    baselinePath: "web/src/pages/MfaChallengeView.tsx",
    currentPath: "web/src/mfa/MfaChallengeView.tsx",
    normalizedSha256: "2c5b3cd8d99bc5a2dc1efe5f87ab2051380b97c7bb7b81e9a2e5a714520be77e",
  },
  {
    baselinePath: "web/src/pages/SignIn.tsx",
    currentPath: "web/src/auth/pages/SignIn.tsx",
    normalizedSha256: "c10b0352bae634e6cddc6f0854c299b94fc4708ad9222c3d1ace09f2bfeb28c9",
  },
  {
    baselinePath: "web/src/pages/SignUp.tsx",
    currentPath: "web/src/auth/pages/SignUp.tsx",
    normalizedSha256: "d9a6d69385ac6ca82764b7b85609d8ffc724dd92cb2aaf60ef822a7b4a1f4dac",
  },
  {
    baselinePath: "web/src/pages/account/Connections.tsx",
    currentPath: "web/src/account/pages/Connections.tsx",
    normalizedSha256: "ca8e39a6a3967ba2165b4d96c7df87670c7d4411779a8fc9a835742df2f4c6b1",
  },
  {
    baselinePath: "web/src/pages/account/Sessions.tsx",
    currentPath: "web/src/account/pages/Sessions.tsx",
    normalizedSha256: "ad6d9e26519f4f16c29e3bc689ccf6da9c671f9488e67d3834f5d44892461393",
  },
] as const satisfies readonly MoveManifestEntry[];

export const WEB_DOMAIN_RAW_MANIFEST = [
  {
    baselinePath: "web/src/index.css",
    currentPath: "web/src/index.css",
    rawSha256: "b4e2226615badce6a8b2f4994c960059e15f1a6208471ac64152e4b8f611f7a4",
  },
  {
    baselinePath: "web/src/vite-env.d.ts",
    currentPath: "web/src/vite-env.d.ts",
    rawSha256: "65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5",
  },
] as const satisfies readonly RawManifestEntry[];
