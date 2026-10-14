import { Elysia } from "elysia";
import { parse } from "../validation";
import { passwordSchema } from "./model";
import { auth, adminEmail, hashPassword, provisionAdmin } from "./service";
import { getConfig, setConfig } from "../store";
import { ApiError, body, json } from "../http";

const attempts = new Map<string, { count: number; until: number }>();
let setupInProgress = false;

function limitAuth(peer: string) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const entry = attempts.get(peer) || { count: 0, until: now + 15 * 60000 };
  if (entry.count >= 12)
    throw new ApiError(429, "Too many authentication attempts. Try again in 15 minutes.");
  entry.count++;
  attempts.set(peer, entry);
}

export async function requireAuth(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, "Sign in to continue.");
}

async function signIn(request: Request, peer: string, setup: boolean) {
  limitAuth(peer);
  const { password } = parse(passwordSchema, await body(request));
  if (setup) {
    if (setupInProgress || getConfig<string>("passwordHash"))
      throw new ApiError(409, "The dashboard is already configured.");
    setupInProgress = true;
    try {
      const hash = await hashPassword(password);
      await provisionAdmin(hash);
      setConfig("passwordHash", hash);
    } finally {
      setupInProgress = false;
    }
  }
  const response = await auth.api.signInEmail({
    body: { email: adminEmail, password },
    headers: request.headers,
    asResponse: true,
  });
  if (response.status === 401) throw new ApiError(401, "Incorrect password.");
  if (!response.ok) throw new ApiError(500, "Unable to sign in.");
  attempts.delete(peer);
  return json({ ok: true }, 200, response.headers);
}

export const authRoutes = new Elysia({ name: "auth", prefix: "/api/auth" })
  .get("/status", async ({ request }) =>
    json({
      setupRequired: !getConfig<string>("passwordHash"),
      authenticated: !!(await auth.api.getSession({ headers: request.headers })),
    }),
  )
  .post(
    "/setup",
    ({ request, server }) =>
      signIn(request, server?.requestIP(request)?.address || "unknown", true),
    { parse: "none" },
  )
  .post(
    "/login",
    ({ request, server }) =>
      signIn(request, server?.requestIP(request)?.address || "unknown", false),
    { parse: "none" },
  )
  .post(
    "/logout",
    async ({ request }) => {
      await requireAuth(request);
      const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
      if (!response.ok) throw new ApiError(500, "Unable to sign out.");
      return json({ ok: true }, 200, response.headers);
    },
    { parse: "none" },
  );
