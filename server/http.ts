export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200, headers?: HeadersInit) {
  const outgoing = new Headers(headers);
  outgoing.set("Content-Type", "application/json; charset=utf-8");
  outgoing.set("Cache-Control", "no-store");
  outgoing.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers: outgoing });
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new ApiError(415, "Use application/json.");
  if (Number(request.headers.get("content-length")) > 16384)
    throw new ApiError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A JSON object is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 16384) {
        await reader.cancel();
        throw new ApiError(413, "Request is too large.");
      }
      chunks.push(next.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid object");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "A valid JSON object is required.");
  } finally {
    reader.releaseLock();
  }
}
