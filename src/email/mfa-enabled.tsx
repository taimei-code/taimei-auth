import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Tailwind,
} from "@react-email/components";

type MfaEnabledEmailProps = {
  appName: string;
  securityUrl: string;
  supportEmail: string;
};

// TOTP secret とリカバリーコードは本文に載せないこと。ログイン手段が Magic Link = メールである
// 以上、受信箱に第二要素を置くと 1 経路の突破で両方が揃い、MFA の前提そのものが消える。
export default function MfaEnabledEmail({
  appName = "taimei",
  securityUrl = "https://auth.taimei-code.com/account/security",
  supportEmail = "support@taimei-code.com",
}: MfaEnabledEmailProps) {
  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>多要素認証 (MFA) を有効にしました</Preview>
      <Tailwind>
        <Body className="mx-auto bg-white font-sans">
          <Container className="mx-auto max-w-[480px] px-6 py-12">
            <Section className="mt-4">
              <Heading
                className="m-0 text-center text-2xl font-medium tracking-tight"
                style={{ color: "#171717" }}
              >
                多要素認証 (MFA) を有効にしました
              </Heading>

              <Text
                className="mt-4 text-center text-base leading-relaxed"
                style={{ color: "#737373" }}
              >
                {appName} のアカウントで多要素認証 (MFA) が有効になりました。
                <br />
                以後のログインでは、認証アプリが表示する 6 桁のコードの入力が必要になります。
              </Text>
            </Section>

            <Section className="mt-6">
              <Text
                className="m-0 text-center text-sm leading-relaxed"
                style={{ color: "#737373" }}
              >
                認証アプリを使えなくなった場合は、有効化時に表示したリカバリーコードでログインできます。
              </Text>
            </Section>

            <Section className="mt-8 text-center">
              <Button
                href={securityUrl}
                className="inline-block rounded-lg px-8 py-3 text-center text-base font-medium text-white no-underline"
                style={{ backgroundColor: "#171717" }}
              >
                セキュリティ設定を確認する
              </Button>
            </Section>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Section>
              <Text
                className="m-0 text-center text-sm leading-relaxed"
                style={{ color: "#dc2626" }}
              >
                この操作に心当たりがない場合は、第三者がアカウントを操作している可能性があります。
                <br />
                <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> までご連絡ください。
              </Text>
            </Section>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Text className="m-0 text-center text-xs" style={{ color: "#d4d4d4" }}>
              © {new Date().getFullYear()} {appName}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
