import { resolve, sep, extname } from "node:path";
import { stat } from "node:fs/promises";
import { dist } from "./config";
import { ApiError } from "./http";
export async function staticFile(request: Request, pathname: string) {
  if (!["GET", "HEAD"].includes(request.method)) throw new ApiError(405, "Method not allowed.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ApiError(400, "Invalid URL.");
  }
  const target = resolve(dist, "." + decoded);
  if (target !== dist && !target.startsWith(dist + sep)) throw new ApiError(404, "Not found.");
  if (decoded.split("/").some((part) => part.startsWith(".") && part.length > 1))
    throw new ApiError(404, "Not found.");
  let file = Bun.file(target);
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) {
    if (extname(decoded)) throw new ApiError(404, "Not found.");
    file = Bun.file(resolve(dist, "index.html"));
  }
  if (!(await file.exists()))
    return new Response("Dashboard assets have not been built. Run bun run build.", {
      status: 503,
    });
  return new Response(request.method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.size),
      "Cache-Control": decoded.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    },
  });
}
