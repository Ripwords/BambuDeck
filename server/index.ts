import { Elysia } from "elysia";
import { resolve, sep, extname } from "node:path";
import { stat } from "node:fs/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import {
  db,
  getConfig,
  setConfig,
  printers,
  printer,
  savePrinter,
  deletePrinter,
  publicPrinter,
  validSession,
  newSession,
  removeSession,
  settings,
  type Printer,
} from "./store";
import {
  ApiError,
  engineReady,
  restartEngine,
  shutdownEngine,
  forgetPrinter,
  connect,
  proxy,
} from "./engine";

const cookieName = "bambudeck_dashboard";
const configuredOrigin = process.env.APP_ORIGIN || process.env.PUBLIC_ORIGIN;
const publicOrigin = configuredOrigin ? new URL(configuredOrigin).origin : null;
if (!!process.env.TLS_CERT_FILE !== !!process.env.TLS_KEY_FILE)
  throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be configured together");
const tls =
  process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
    ? {
        cert: Bun.file(process.env.TLS_CERT_FILE),
        key: Bun.file(process.env.TLS_KEY_FILE),
      }
    : undefined;
const dist = resolve(process.env.STATIC_DIR || "./dist");
const attempts = new Map<string, { count: number; until: number }>();
let setupInProgress = false;
let settingsWork: Promise<unknown> = Promise.resolve();

function json(value: unknown, status = 200, headers?: HeadersInit) {
  const outgoing = new Headers(headers);
  outgoing.set("Content-Type", "application/json; charset=utf-8");
  outgoing.set("Cache-Control", "no-store");
  outgoing.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers: outgoing });
}
function sessionToken(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
}
function cookie(request: Request, token: string, logout = false) {
  const secure = (publicOrigin || new URL(request.url).origin).startsWith(
    "https:",
  );
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : 7 * 86400}${secure ? "; Secure" : ""}`;
}
function enforceMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("X-Requested-With") !== "BambuDeck")
    throw new ApiError(403, "Missing request protection header.");
  const expected = publicOrigin || new URL(request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new ApiError(403, "Request origin is not allowed.");
}
function limitAuth(peer: string) {
  const now = Date.now();
  for (const [key, entry] of attempts)
    if (entry.until <= now) attempts.delete(key);
  const entry = attempts.get(peer) || { count: 0, until: now + 15 * 60000 };
  if (entry.count >= 12)
    throw new ApiError(
      429,
      "Too many authentication attempts. Try again in 15 minutes.",
    );
  entry.count++;
  attempts.set(peer, entry);
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
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
function textField(value: unknown, label: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new ApiError(400, `Invalid ${label}.`);
  return value.trim();
}
function profileBody(
  value: Record<string, unknown>,
  current?: Printer,
): Printer {
  const name = textField(value.name, "printer name", 80);
  const host =
    value.host === undefined || value.host === ""
      ? current?.host || ""
      : textField(value.host, "host");
  const serial =
    value.serial === undefined || value.serial === ""
      ? current?.serial || ""
      : textField(value.serial, "serial number", 64);
  const code =
    value.code === undefined || value.code === ""
      ? current?.code || ""
      : textField(value.code, "LAN access code", 64);
  if (!name || !host || !serial || !code)
    throw new ApiError(
      400,
      "Name, host, serial number, and LAN access code are required.",
    );
  if (
    !isIP(host) &&
    !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
  )
    throw new ApiError(
      400,
      "Host must be an IP address or hostname without a port or URL scheme.",
    );
  if (!/^[a-zA-Z0-9_-]+$/.test(serial))
    throw new ApiError(400, "Invalid serial number.");
  if (
    printers().some(
      (value) =>
        value.id !== current?.id &&
        value.serial.toLowerCase() === serial.toLowerCase(),
    )
  )
    throw new ApiError(409, "A profile for this serial number already exists.");
  return { id: current?.id || randomUUID(), name, host, serial, code };
}
function requirePrinter(id: string) {
  const value = printer(id);
  if (!value) throw new ApiError(404, "Printer profile not found.");
  return value;
}
async function api(
  request: Request,
  path: string,
  peer: string,
): Promise<Response> {
  const method = request.method;
  enforceMutation(request);
  if (path === "/api/health" && method === "GET")
    return json({ ok: true, engineReady: engineReady() });
  if (path === "/api/auth/status" && method === "GET")
    return json({
      setupRequired: !getConfig<string>("passwordHash"),
      authenticated: validSession(sessionToken(request)),
    });
  if (
    (path === "/api/auth/setup" || path === "/api/auth/login") &&
    method === "POST"
  ) {
    limitAuth(peer);
    const data = await body(request);
    const password = typeof data.password === "string" ? data.password : "";
    if (password.length < 12 || password.length > 256)
      throw new ApiError(400, "Password must contain 12–256 characters.");
    if (path.endsWith("/setup")) {
      if (setupInProgress || getConfig<string>("passwordHash"))
        throw new ApiError(409, "The dashboard is already configured.");
      setupInProgress = true;
      try {
        setConfig(
          "passwordHash",
          await Bun.password.hash(password, {
            algorithm: "argon2id",
            memoryCost: 65536,
            timeCost: 3,
          }),
        );
      } finally {
        setupInProgress = false;
      }
    } else {
      const hash = getConfig<string>("passwordHash");
      if (!hash || !(await Bun.password.verify(password, hash)))
        throw new ApiError(401, "Incorrect password.");
    }
    attempts.delete(peer);
    return json({ ok: true }, 200, {
      "Set-Cookie": cookie(request, newSession()),
    });
  }
  if (!validSession(sessionToken(request)))
    throw new ApiError(401, "Sign in to continue.");
  if (path === "/api/auth/logout" && method === "POST") {
    removeSession(sessionToken(request));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", true) });
  }
  if (path === "/api/printers" && method === "GET")
    return json(printers().map(publicPrinter));
  if (path === "/api/printers" && method === "POST") {
    const profile = profileBody(await body(request));
    savePrinter(profile);
    return json(publicPrinter(profile), 201);
  }
  const match = path.match(
    /^\/api\/printers\/([a-f0-9-]+)(?:\/(connect|camera|b\/[^/]+))?$/,
  );
  if (match) {
    const profile = requirePrinter(match[1]!);
    const action = match[2];
    if (!action && method === "PUT") {
      const updated = profileBody(await body(request), profile);
      savePrinter(updated);
      await forgetPrinter(profile.id);
      return json(publicPrinter(updated));
    }
    if (!action && method === "DELETE") {
      deletePrinter(profile.id);
      await forgetPrinter(profile.id);
      return json({ ok: true });
    }
    if (action === "connect" && method === "POST") {
      await connect(profile);
      return json({ ok: true });
    }
    if (action === "camera" || action?.startsWith("b/"))
      return proxy(
        request,
        profile,
        action === "camera" ? action : action.slice(2),
      );
  }
  if (path === "/api/settings" && method === "GET") {
    const config = settings();
    return json({
      mqttBroker: config.mqttBroker,
      mqttUser: config.mqttUser,
      mqttPrefix: config.mqttPrefix,
      mqttPasswordSet: !!config.mqttPassword,
    });
  }
  if (path === "/api/settings" && method === "PUT") {
    const data = await body(request);
    const mqttBroker = textField(data.mqttBroker, "MQTT broker");
    if (mqttBroker && !/^(tcp|ssl|tls|ws|wss):\/\/[^\s]+$/.test(mqttBroker))
      throw new ApiError(
        400,
        "MQTT broker must use tcp://, ssl://, tls://, ws://, or wss://.",
      );
    if (mqttBroker) {
      let broker: URL;
      try {
        broker = new URL(mqttBroker);
      } catch {
        throw new ApiError(400, "Invalid MQTT broker URL.");
      }
      if (broker.username || broker.password)
        throw new ApiError(
          400,
          "Use the separate MQTT username and password fields.",
        );
    }
    const mqttUser = textField(data.mqttUser, "MQTT username");
    const mqttPrefix = textField(data.mqttPrefix, "MQTT prefix", 128);
    if (/[+#]/.test(mqttPrefix))
      throw new ApiError(400, "MQTT prefix cannot contain wildcards.");
    const mqttPassword =
      data.mqttPassword === undefined ? "" : data.mqttPassword;
    if (
      typeof mqttPassword !== "string" ||
      mqttPassword.length > 1024 ||
      mqttPassword.includes("\0")
    )
      throw new ApiError(400, "Invalid MQTT password.");
    const work = settingsWork.then(async () => {
      setConfig("settings", {
        mqttBroker,
        mqttUser,
        mqttPrefix: mqttPrefix || "homeassistant",
        mqttPassword: mqttPassword || settings().mqttPassword,
      });
      await restartEngine();
      return json({ ok: true, engineReady: engineReady() });
    });
    settingsWork = work.catch(() => {});
    return work;
  }
  throw new ApiError(404, "API endpoint not found.");
}

async function staticFile(request: Request, pathname: string) {
  if (!["GET", "HEAD"].includes(request.method))
    throw new ApiError(405, "Method not allowed.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ApiError(400, "Invalid URL.");
  }
  const target = resolve(dist, "." + decoded);
  if (target !== dist && !target.startsWith(dist + sep))
    throw new ApiError(404, "Not found.");
  if (
    decoded.split("/").some((part) => part.startsWith(".") && part.length > 1)
  )
    throw new ApiError(404, "Not found.");
  let file = Bun.file(target);
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) {
    if (extname(decoded)) throw new ApiError(404, "Not found.");
    file = Bun.file(resolve(dist, "index.html"));
  }
  if (!(await file.exists()))
    return new Response(
      "Dashboard assets have not been built. Run bun run build.",
      { status: 503 },
    );
  return new Response(request.method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": file.type,
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

const app = new Elysia({
  serve: { idleTimeout: 0, maxRequestBodySize: 2 * 1024 * 1024 * 1024 },
})
  .all(
    "*",
    async ({ request, server }) => {
      try {
        const path = new URL(request.url).pathname;
        if (path === "/api" || path.startsWith("/api/"))
          return await api(
            request,
            path,
            server?.requestIP(request)?.address || "unknown",
          );
        return await staticFile(request, path);
      } catch (error) {
        if (error instanceof ApiError)
          return json({ error: error.message }, error.status);
        console.error("Dashboard request failed.");
        return json({ error: "The request could not be completed." }, 500);
      }
    },
    { parse: "none" },
  )
  .listen({
    hostname: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 3000),
    tls,
  });

console.info(`BambuDeck listening on port ${app.server?.port}`);
void restartEngine().catch(() =>
  console.warn(
    "Printer engine is unavailable; profile management remains available.",
  ),
);
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  await shutdownEngine();
  await app.stop(true);
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
