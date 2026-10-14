import { ApiError } from "./http";
import { publicOrigin } from "./config";
export function enforceMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("X-Requested-With") !== "BambuDeck")
    throw new ApiError(403, "Missing request protection header.");
  const expected = publicOrigin || new URL(request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new ApiError(403, "Request origin is not allowed.");
}
