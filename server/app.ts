import { Elysia } from "elysia";
import { ApiError, json } from "./http";
import { enforceMutation } from "./security";
import { staticFile } from "./static";
import { authRoutes, requireAuth } from "./auth/routes";
import { printerRoutes } from "./printers/routes";
import { settingsRoutes } from "./settings/routes";
import { engineReady } from "./engine";
export const app = new Elysia({
  serve: { idleTimeout: 0, maxRequestBodySize: 2 * 1024 * 1024 * 1024 },
})
  .onError(({ error, code }) => {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (code === "NOT_FOUND") return json({ error: "API endpoint not found." }, 404);
    console.error("Dashboard request failed.");
    return json({ error: "The request could not be completed." }, 500);
  })
  .onRequest(async ({ request }) => {
    const path = new URL(request.url).pathname;
    if (path !== "/api" && !path.startsWith("/api/")) return;
    enforceMutation(request);
    if (path !== "/api/health" && !path.startsWith("/api/auth/")) await requireAuth(request);
  })
  .get("/api/health", () => json({ ok: true, engineReady: engineReady() }))
  .use(authRoutes)
  .use(printerRoutes)
  .use(settingsRoutes)
  .all(
    "*",
    ({ request }) => {
      const path = new URL(request.url).pathname;
      if (path === "/api" || path.startsWith("/api/"))
        throw new ApiError(404, "API endpoint not found.");
      return staticFile(request, path);
    },
    { parse: "none" },
  );
