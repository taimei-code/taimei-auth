import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const items = [
  {
    title: "Passkey",
    description: "指紋・顔認証・PIN でログインできます",
    status: "実装予定",
  },
  {
    title: "パスワード変更",
    description: "メール + 現パスワードで新しいパスワードに更新できます",
    status: "実装予定",
  },
  {
    title: "多要素認証 (MFA)",
    description: "TOTP / 認証アプリでログイン時に追加の確認コードを要求します",
    status: "実装予定",
  },
] as const;

export const Security = () => {
  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">セキュリティ</h1>
        <p className="mt-1 text-sm text-muted-foreground">認証方法とセキュリティ設定</p>
      </div>
      <Separator className="my-6" />

      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.title} className="flex items-start justify-between gap-4 py-5">
            <div>
              <p className="font-medium">{item.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {item.status}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
};
