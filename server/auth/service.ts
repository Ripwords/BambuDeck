import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { db, getConfig, setConfig } from "../store";
import { publicOrigin, tls } from "../config";

export const adminEmail = "admin@bambudeck.local";
let secret = getConfig<string>("authSecret");
if (!secret) {
  secret = randomBytes(48).toString("base64url");
  setConfig("authSecret", secret);
}

export function hashPassword(password: string) {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 3,
  });
}

export const auth = betterAuth({
  appName: "BambuDeck",
  baseURL: publicOrigin || `${tls ? "https" : "http"}://localhost:${process.env.PORT || 3000}`,
  database: db,
  secret,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 256,
    password: {
      hash: hashPassword,
      verify: ({ password, hash }) => Bun.password.verify(password, hash),
    },
  },
  user: { modelName: "auth_user" },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  session: {
    modelName: "auth_session",
    expiresIn: 7 * 86400,
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  advanced: {
    cookiePrefix: "bambudeck",
    useSecureCookies: publicOrigin ? publicOrigin.startsWith("https:") : !!tls,
    defaultCookieAttributes: { httpOnly: true, sameSite: "strict", path: "/" },
  },
  telemetry: { enabled: false },
});

export async function provisionAdmin(hash: string) {
  const { internalAdapter } = await auth.$context;
  const existing = await internalAdapter.findUserByEmail(adminEmail, { includeAccounts: true });
  const user =
    existing?.user ||
    (await internalAdapter.createUser(
      {
        email: adminEmail,
        name: "Administrator",
        emailVerified: true,
      },
      { method: "admin" },
    ));
  if (!existing?.accounts.some((account) => account.providerId === "credential")) {
    await internalAdapter.createAccount({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hash,
    });
  } else {
    await internalAdapter.updatePassword(user.id, hash);
  }
}

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
const passwordHash = getConfig<string>("passwordHash");
if (passwordHash) await provisionAdmin(passwordHash);
