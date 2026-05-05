import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// PR8b では UI 表示のみ。Passkey 登録/削除は PR11、パスワード変更/MFA は Phase 4。
export const Security = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">セキュリティ</h1>
        <p className="text-sm text-muted-foreground">認証方法とセキュリティ設定</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Passkey</CardTitle>
          <CardDescription>指紋・顔認証・PIN でログインできます (PR11 で実装予定)</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>パスワード変更</CardTitle>
          <CardDescription>Phase 4 で実装予定</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>多要素認証 (MFA)</CardTitle>
          <CardDescription>Phase 4 で実装予定</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
};
