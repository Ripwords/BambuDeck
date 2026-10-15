export async function api<T = any>(
  url: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Requested-With"] = "BambuDeck";
  const native = body instanceof FormData || body instanceof URLSearchParams;
  if (body !== undefined && !native) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(body === undefined ? {} : { body: native ? body : JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = await response.text();
    try {
      const parsed = JSON.parse(message);
      message = parsed.error || parsed.message || message;
    } catch {}
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : ((await response.text()) as T);
}
export function form(values: Record<string, unknown>) {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
}
export function merge(target: Record<string, any>, source: Record<string, any>) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      merge(target[key], value);
    } else target[key] = value;
  }
}
