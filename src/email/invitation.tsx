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
import { sanitizeDisplayText } from "./sanitize";

type InvitationEmailProps = {
  url: string;
  appName: string;
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  inviteeEmail: string;
  roleLabel: string;
  supportEmail: string;
  abuseUrl: string;
};

export default function InvitationEmail({
  url = "https://auth.taimei-code.com/api/auth/magic-link/verify?token=xxx",
  appName = "taimei",
  companyName = "サンプル事業所",
  inviterName = "山田太郎",
  inviterEmail = "owner@example.com",
  inviteeEmail = "invitee@example.com",
  roleLabel = "メンバー",
  supportEmail = "support@taimei-code.com",
  abuseUrl = "https://taimei-code.com/security",
}: InvitationEmailProps) {
  const safeCompany = sanitizeDisplayText(companyName);
  const safeInviter = sanitizeDisplayText(inviterName);
  const safeInviterEmail = sanitizeDisplayText(inviterEmail);

  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>
        {safeInviter} さんから「{safeCompany}」への招待
      </Preview>
      <Tailwind>
        <Body className="mx-auto bg-white font-sans">
          <Container className="mx-auto max-w-[480px] px-6 py-12">
            <Section className="mt-4">
              <Heading
                className="m-0 text-center text-2xl font-medium tracking-tight"
                style={{ color: "#171717" }}
              >
                事業所への招待
              </Heading>
              <Text
                className="mt-4 text-center text-base leading-relaxed"
                style={{ color: "#737373" }}
              >
                {safeInviter} さん ({safeInviterEmail}) から
                <br />「{safeCompany}」への参加 ({roleLabel}) に招待されています。
              </Text>
            </Section>

            <Section className="mt-8 text-center">
              <Button
                href={url}
                className="inline-block rounded-lg px-8 py-3 text-center text-base font-medium text-white no-underline"
                style={{ backgroundColor: "#171717" }}
              >
                招待を受諾する
              </Button>
            </Section>

            <Text className="mt-6 text-center text-sm" style={{ color: "#dc2626" }}>
              この招待リンクは24時間有効です
            </Text>

            <Section className="mt-6">
              <Text
                className="m-0 text-center text-sm leading-relaxed"
                style={{ color: "#737373" }}
              >
                この招待は <strong>{inviteeEmail}</strong> 宛です。
                <br />
                受諾には同じメールアドレスでのログインが必要です。
              </Text>
            </Section>

            <Hr className="my-10" style={{ borderColor: "#e5e5e5" }} />

            <Section>
              <Text
                className="m-0 text-center text-xs leading-relaxed"
                style={{ color: "#a3a3a3" }}
              >
                ボタンが機能しない場合は、以下の URL をブラウザに貼り付けてください。 URL が
                auth.taimei-code.com で始まることを確認してください。
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
                招待に心当たりがない場合は、このメールを無視してください。
                <br />
                不審なメールは <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>{" "}
                までご連絡ください。
                <br />
                IT 管理者向け SPF/DKIM 情報: <Link href={abuseUrl}>{abuseUrl}</Link>
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
