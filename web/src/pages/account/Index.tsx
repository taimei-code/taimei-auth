import {
  useState,
  useEffect,
  type FormEvent,
  type ChangeEvent,
} from "react";
import { upload } from "@vercel/blob/client";
import { Loader2, Upload, Trash2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// プロフィール表示 + 名前/avatar 編集 + 退会実行。
// avatar は Vercel Blob client upload (handleUploadUrl で Hono の avatar-upload-token endpoint
// に問い合わせ → signed token で blob に直接 PUT)。upload 完了後、authClient.updateUser({ image })
// で URL を保存する 2 段階処理。
//
// 退会は確認ダイアログ (再認証なし、シンプルな確認のみ)。Magic Link / OAuth ユーザーは
// password 持たないため password 再入力は不要。Better Auth の deleteUser で session ごと完全削除。
export const AccountIndex = () => {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setImageUrl(user.image ?? "");
    }
  }, [user]);

  if (!user) {
    return null;
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setSavedMessage(null);
    const { error } = await authClient.updateUser({ name, image: imageUrl });
    setSubmitting(false);
    if (error) {
      setErrorMessage(error.message ?? "保存に失敗しました");
      return;
    }
    setSavedMessage("保存しました");
  };

  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorMessage(null);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/account/avatar/upload-token",
      });
      setImageUrl(blob.url);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "アップロードに失敗しました",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await authClient.deleteUser({});
    if (error) {
      setDeleting(false);
      setErrorMessage(error.message ?? "退会処理に失敗しました");
      return;
    }
    window.location.href = "/auth";
  };

  const initial = name.charAt(0).toUpperCase() || "?";

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
          <CardTitle>プロフィール情報</CardTitle>
        </CardHeader>
        <form onSubmit={handleSave}>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <Label
                  htmlFor="avatar-upload"
                  className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline"
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  画像をアップロード
                </Label>
                <Input
                  id="avatar-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  PNG / JPEG / WebP, 5MB まで
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input id="email" value={user.email} disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">お名前</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            {errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}
            {savedMessage && (
              <p className="text-sm text-muted-foreground">{savedMessage}</p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={submitting || uploading}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">退会</CardTitle>
          <CardDescription>
            アカウントを削除します。すべてのデータが削除され、復元できません。
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="size-4" />
                退会する
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>退会の確認</DialogTitle>
                <DialogDescription>
                  本当にアカウントを削除しますか? この操作は取り消せません。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">キャンセル</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting && <Loader2 className="size-4 animate-spin" />}
                  退会を確定する
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      </Card>
    </div>
  );
};
