import { type ChangeEvent, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { upload } from "@vercel/blob/client";

import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialImageUrl: string;
  fallbackName: string;
};

// Vercel Blob client upload (handleUploadUrl で Hono の avatar-upload-token endpoint に問い合わせ
// → signed token で blob に直接 PUT) → 完了後すぐ authClient.updateUser({ image }) で永続化する。
// 「画像を変更」と「保存」を分けず即時保存にする理由: アップロード後 form 保存を忘れて画面遷移すると
// blob は残るが user.image に反映されないという data drift が発生するため、両者を 1 アクションに束ねる。
export const AvatarUploader = ({ initialImageUrl, fallbackName }: Props) => {
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const uploadAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorMessage(null);
    upload(file.name, file, {
      access: "public",
      handleUploadUrl: "/api/account/avatar/upload-token",
    })
      .then((blob) => {
        setImageUrl(blob.url);
        return authClient.updateUser({ image: blob.url });
      })
      .then((result) => {
        if (result?.error) {
          setErrorMessage(result.error.message ?? "画像の保存に失敗しました");
        }
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "アップロードに失敗しました");
      })
      .finally(() => setUploading(false));
  };

  const initial = fallbackName.charAt(0).toUpperCase() || "?";

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">プロフィール写真</div>
      <Avatar className="size-32">
        {imageUrl ? <AvatarImage src={imageUrl} alt={fallbackName} /> : null}
        <AvatarFallback className="text-3xl">{initial}</AvatarFallback>
      </Avatar>
      <div>
        <Label
          htmlFor="avatar-upload"
          className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-4" aria-hidden="true" />
          )}
          {uploading ? "アップロード中…" : "画像を変更"}
        </Label>
        <Input
          id="avatar-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={uploadAvatar}
          disabled={uploading}
          aria-describedby="avatar-help"
        />
      </div>
      <p id="avatar-help" className="text-xs text-muted-foreground">
        PNG / JPEG / WebP, 5&nbsp;MB&nbsp;まで
      </p>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
};
