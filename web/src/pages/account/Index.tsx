import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// PR8a の placeholder: PR8b で表示 (name / email / created_at) + 編集 (name, avatar URL) + 退会実行に置換。
export const AccountIndex = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">プロフィール</h1>
        <p className="text-sm text-muted-foreground">
          アカウント情報の表示と編集
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>placeholder</CardTitle>
          <CardDescription>
            PR8b で name / email / created_at の表示と name / avatar URL 編集を実装します。
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
};
