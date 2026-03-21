import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  Tailwind,
} from "@react-email/components";

type MagicLinkEmailProps = {
  url: string;
  appName: string;
};

export default function MagicLinkEmail({
  url = "https://example.com/auth/magic-link?token=xxx",
  appName = "Taimei",
}: MagicLinkEmailProps) {
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
      <Preview>{appName} へのログインリンク - 5分間有効</Preview>
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
                ログインリクエスト
              </Heading>

              <Text
                className="mt-4 text-center text-base leading-relaxed"
                style={{ color: "#737373" }}
              >
                {appName} へのログインリンクをお送りします。
                <br />
                下のボタンをクリックしてログインしてください。
              </Text>
            </Section>

            <Section className="mt-8 text-center">
              <Button
                href={url}
                className="inline-block rounded-lg px-8 py-3 text-center text-base font-medium text-white no-underline"
                style={{ backgroundColor: "#171717" }}
              >
                ログインする
              </Button>
            </Section>

            <Text
              className="mt-6 text-center text-sm"
              style={{ color: "#dc2626" }}
            >
              このリンクは5分間有効です
            </Text>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Section>
              <Text
                className="m-0 text-center text-xs leading-relaxed"
                style={{ color: "#a3a3a3" }}
              >
                ボタンが機能しない場合は、以下のURLをコピーしてブラウザに貼り付けてください
              </Text>
              <Text className="mt-2 text-center">
                <Link
                  href={url}
                  className="break-all text-xs underline"
                  style={{ color: "#dc2626" }}
                >
                  {url}
                </Link>
              </Text>
            </Section>

            <Section className="mt-8">
              <Text
                className="m-0 text-center text-xs leading-relaxed"
                style={{ color: "#a3a3a3" }}
              >
                このリンクは1回のみ使用可能です。
                <br />
                心当たりのない場合は、このメールを無視してください。
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
