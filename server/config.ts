import { resolve } from "node:path";
const configuredOrigin = process.env.APP_ORIGIN || process.env.PUBLIC_ORIGIN;
export const publicOrigin = configuredOrigin ? new URL(configuredOrigin).origin : null;
if (!!process.env.TLS_CERT_FILE !== !!process.env.TLS_KEY_FILE)
  throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be configured together");
export const tls =
  process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
    ? {
        cert: Bun.file(process.env.TLS_CERT_FILE),
        key: Bun.file(process.env.TLS_KEY_FILE),
      }
    : undefined;
export const dist = resolve(process.env.STATIC_DIR || "./dist");
