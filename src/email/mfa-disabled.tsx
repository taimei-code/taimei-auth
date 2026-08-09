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

type MfaDisabledEmailProps = {
  appName: string;
  securityUrl: string;
  supportEmail: string;
};

// 有効化通知より踏み込んだ警告文にする。無効化には現在の TOTP コードかリカバリーコードが要る
// ため、本人の操作でないなら第二要素まで渡っており、放置は保護が外れたままを意味する。
export default function MfaDisabledEmail({
  appName = "taimei",
  securityUrl = "https://auth.taimei-code.com/account/security",
  supportEmail = "support@taimei-code.com",
}: MfaDisabledEmailProps) {
  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>多要素認証 (MFA) を無効にしました</Preview>
      <Tailwind>
        <Body className="mx-auto bg-white font-sans">
          <Container className="mx-auto max-w-[480px] px-6 py-12">
            <Section className="mt-4">
              <Heading
                className="m-0 text-center text-2xl font-medium tracking-tight"
                style={{ color: "#171717" }}
              >
                多要素認証 (MFA) を無効にしました
              </Heading>

              <Text
                className="mt-4 text-center text-base leading-relaxed"
                style={{ color: "#737373" }}
              >
                {appName} のアカウントで多要素認証 (MFA) が無効になりました。
                <br />
                以後のログインでは、認証アプリのコードは求められません。
              </Text>
            </Section>

            <Section className="mt-6">
              <Text
                className="m-0 text-center text-sm leading-relaxed"
                style={{ color: "#dc2626" }}
              >
                この操作に心当たりがない場合、第三者があなたのアカウントと第二要素の両方を
                手に入れている可能性があります。
                <br />
                ただちに多要素認証 (MFA) を再度有効にし、
                <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> までご連絡ください。
              </Text>
            </Section>

            <Section className="mt-8 text-center">
              <Button
                href={securityUrl}
                className="inline-block rounded-lg px-8 py-3 text-center text-base font-medium text-white no-underline"
                style={{ backgroundColor: "#171717" }}
              >
                セキュリティ設定を開く
              </Button>
            </Section>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Section>
              <Text
                className="m-0 text-center text-sm leading-relaxed"
                style={{ color: "#737373" }}
              >
                これまでに発行したリカバリーコードは無効になりました。
                <br />
                再度有効にすると、新しい認証アプリの登録とリカバリーコードの発行をやり直します。
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
