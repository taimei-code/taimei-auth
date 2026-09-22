# ADR-0008: avatar はアップロード完了と同時に永続化する (form 保存と分離しない)

## Context

`/account` のプロフィール編集画面では、`name` は form 保存方式 (入力してから「保存」ボタンで反映) である。avatar も同じ form に含めるか、別のアクションにするかという選択がある。

Vercel Blob の client upload は次の流れになる。クライアントが server の endpoint (`/api/account/avatar/upload-token`) から signed token を取得し、blob に直接 PUT して、blob URL を受け取る。この時点で **blob は外部に永続化済み** だが、`user.image` カラムには反映されていない。

## Decision

`web/src/account/AvatarUploader.tsx` で、blob upload が完了した直後に `authClient.updateUser({ image: blobUrl })` を続けて呼ぶ。「画像を変更」と「保存」を form の中で分離せず、ファイル選択という 1 アクションで blob upload から DB 反映までを完結させる。

## Why

「画像を変更」と「保存ボタン」を分離すると、次の順でデータのずれが発生する。

1. ユーザーがファイルを選択し、blob upload が成功する (Vercel に画像が永続化される)
2. 「保存」を押さずに画面遷移またはリロードする
3. blob は残るが `user.image` は古い URL のままになる

blob 側に残る orphan は Vercel の課金対象で (小さいが累積する)、UX 上も「アップロードしたつもりが反映されていない」状態になる。1 アクションにまとめれば原理的に発生しない。

## Consequences

- 「アップロードしたが気が変わって取り消したい」場合は別の UI (画像削除ボタン) で対応する想定である。現状は未実装で、必要が出てきたら追加する
- name の form 保存方式とは UX の一貫性が崩れるが、blob upload では「ファイル選択が確定操作である」というメンタルモデルがブラウザ標準のファイル選択 UI と一致する
- アップロード途中でネットワークが切断されたら blob は残らない (未完了の PUT は Vercel 側で破棄される)。upload は完了したが DB 反映に失敗した場合は、`result.error` をユーザーに表示してリトライさせる
