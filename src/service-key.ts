// rotation 中は旧 key も受理するため active + previous を両方返す (docs/runbook/service-key-rotation.md)。
// env 直読みを 1 箇所に閉じてあるのは、将来 AWS Secrets Manager 取得へ差し替えるため。
export function getValidServiceKeys(): string[] {
  const active = process.env.AUTH_SERVICE_KEY;
  const previous = process.env.AUTH_SERVICE_KEY_PREVIOUS;
  return [active, previous].filter((key): key is string => !!key);
}
