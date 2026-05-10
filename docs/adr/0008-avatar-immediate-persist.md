# ADR-0008: avatar はアップロード完了と同時に永続化する (form 保存と分離しない)

## Context

`/account` のプロフィール編集画面では `name` が form 保存方式 (入力 → 「保存」ボタンで反映)。avatar も同じ form に乗せるか、別アクションにするかの選択がある。

Vercel Blob client upload は次の流れ: クライアントが server endpoint (`/api/account/avatar/upload-token`) から signed token を取得 → blob に直接 PUT → blob URL を取得。この時点で **blob は外部に永続化済み**だが、`user.image` カラムには未反映。

## Decision

`web/src/components/account/AvatarUploader.tsx` で、blob upload 完了直後に `authClient.updateUser({ image: blobUrl })` を続けて呼ぶ。「画像を変更」と「保存」を form に分離せず、ファイル選択 1 アクションで blob upload + DB 反映までを完結させる。

## Why

「画像を変更」と「保存ボタン」を分離すると、次の data drift が発生する:

1. ユーザがファイル選択 → blob upload 成功 (Vercel に画像が永続化)
2. 「保存」を押さずに画面遷移 / リロード
3. blob は残るが `user.image` は古い URL のまま

blob 側の orphan は Vercel の課金対象 (small だが累積する) で、UX 上も「アップロードしたつもりが反映されていない」となる。1 アクションに束ねれば原理的に発生しない。

## Consequences

- 「アップロードしたが気が変わって取り消したい」は別 UI (画像削除ボタン) で対応する想定。現状未実装で、必要が出てきたら追加する
- name の form 保存方式とは UX 一貫性が崩れるが、blob upload は「ファイル選択 = 確定操作」というメンタルモデルがブラウザネイティブのファイル選択 UI と一致する
- アップロード途中でネットワーク切断したら blob は残らない (未完了 PUT は Vercel 側で破棄される)。完了 + DB 反映失敗のレースは `result.error` をユーザーに表示してリトライさせる
