export class RequestJsonError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestJsonError";
  }
}

export function describeRequestJsonError(
  error: unknown,
  messagesByStatus: Partial<Record<number, string>> & { fallback: string },
): string {
  if (error instanceof RequestJsonError) {
    const specific = messagesByStatus[error.status];
    if (specific !== undefined) return specific;
  }
  return messagesByStatus.fallback;
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new RequestJsonError(response.status, `GET ${url} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new RequestJsonError(response.status, text || `POST ${url} failed: ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
