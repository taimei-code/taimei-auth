# packages/auth-client/ 境界ルール

- interface を足す・変える時は、`api/` の差分を [ADR-0028](../../docs/adr/0028-sdk-public-interface.md) の 5 層で読む。
- SDK の code、試験、README、CHANGELOG に、consumer の名前、host、path、consumer が画面を使う目的を書かない。
