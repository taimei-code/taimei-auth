import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
  Tailwind,
} from "@react-email/components";

type WelcomeEmailProps = {
  appName: string;
  userName?: string | null;
  dashboardUrl: string;
};

export default function WelcomeEmail({
  appName = "Taimei",
  userName = "ユーザー",
  dashboardUrl = "https://example.com/dashboard",
}: WelcomeEmailProps) {
  const greeting = userName ? `${userName} さん` : "";
  const logoUrl =
    "https://7iv4djergayei7gf.public.blob.vercel-storage.com/taimei/public/my-service-logo.png";

  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>{appName} へようこそ！アカウント作成が完了しました</Preview>
      <Tailwind>
        <Body className="mx-auto bg-white font-sans">
          <Container className="mx-auto max-w-[480px] px-6 py-12">
            <Section className="text-center">
              <Img
                src={logoUrl}
                width="80"
                height="80"
                alt={appName}
                className="mx-auto"
              />
            </Section>

            <Section className="mt-10">
              <Heading
                className="m-0 text-center text-2xl font-medium tracking-tight"
                style={{ color: "#171717" }}
              >
                ようこそ、{greeting}
              </Heading>

              <Text
                className="mt-4 text-center text-base leading-relaxed"
                style={{ color: "#737373" }}
              >
                {appName} へのご登録ありがとうございます。
                <br />
                アカウントの作成が完了しました。
              </Text>
            </Section>

            <Section className="mt-8 text-center">
              <Button
                href={dashboardUrl}
                className="inline-block rounded-lg px-8 py-3 text-center text-base font-medium text-white no-underline"
                style={{ backgroundColor: "#171717" }}
              >
                ダッシュボードへ
              </Button>
            </Section>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Section>
              <Text
                className="m-0 text-center text-sm leading-relaxed"
                style={{ color: "#737373" }}
              >
                ご不明な点がございましたら、
                <br />
                お気軽にお問い合わせください。
              </Text>
            </Section>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Text
              className="m-0 text-center text-xs"
              style={{ color: "#d4d4d4" }}
            >
              © {new Date().getFullYear()} {appName}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
