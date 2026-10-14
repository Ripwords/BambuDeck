import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

const directory = process.env.DATA_DIR || "./data";
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keyPath = join(directory, "secret.key");
let key: Buffer;
if (process.env.APP_ENCRYPTION_KEY) {
  key = Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32)
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes encoded as base64");
} else {
  try {
    key = readFileSync(keyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    key = randomBytes(32);
    writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
  }
  if (key.length !== 32) throw new Error("Invalid encryption key file");
  chmodSync(keyPath, 0o600);
}
const databasePath = join(directory, "bambudeck.sqlite");
export const db = new Database(databasePath, { create: true });
chmodSync(databasePath, 0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS printers (id TEXT PRIMARY KEY, name TEXT NOT NULL, credentials TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);

function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function decrypt<T>(value: string): T {
  const bytes = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}
export function getConfig<T>(name: string): T | null {
  const row = db.query("SELECT value FROM config WHERE key=?").get(name) as {
    value: string;
  } | null;
  return row ? decrypt<T>(row.value) : null;
}
export function setConfig(name: string, value: unknown) {
  db.query("INSERT OR REPLACE INTO config (key,value) VALUES (?,?)").run(
    name,
    encrypt(value),
  );
}
export interface Credentials {
  host: string;
  serial: string;
  code: string;
}
export interface Printer extends Credentials {
  id: string;
  name: string;
}
interface PrinterRow {
  id: string;
  name: string;
  credentials: string;
}
export function printers(): Printer[] {
  return (
    db.query("SELECT * FROM printers ORDER BY rowid").all() as PrinterRow[]
  ).map(decodePrinter);
}
function decodePrinter(row: PrinterRow): Printer {
  return {
    id: row.id,
    name: row.name,
    ...decrypt<Credentials>(row.credentials),
  };
}
export function printer(id: string): Printer | null {
  const row = db
    .query("SELECT * FROM printers WHERE id=?")
    .get(id) as PrinterRow | null;
  return row ? decodePrinter(row) : null;
}
export function savePrinter(value: Printer) {
  db.query(
    "INSERT OR REPLACE INTO printers (id,name,credentials) VALUES (?,?,?)",
  ).run(
    value.id,
    value.name,
    encrypt({ host: value.host, code: value.code, serial: value.serial }),
  );
}
export function deletePrinter(id: string) {
  db.query("DELETE FROM printers WHERE id=?").run(id);
}
export function publicPrinter(value: Printer) {
  return {
    id: value.id,
    name: value.name,
    hostMasked: "••••" + value.host.slice(-3),
    serialMasked: "••••" + value.serial.slice(-4),
  };
}
export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function validSession(token: string | undefined): boolean {
  if (!token) return false;
  return !!db
    .query("SELECT hash FROM sessions WHERE hash=? AND expires>?")
    .get(hashToken(token), Date.now());
}
export function newSession() {
  const token = randomBytes(32).toString("base64url");
  db.query("DELETE FROM sessions WHERE expires<=?").run(Date.now());
  db.query("INSERT INTO sessions (hash,expires) VALUES (?,?)").run(
    hashToken(token),
    Date.now() + 7 * 86400000,
  );
  return token;
}
export function removeSession(token: string | undefined) {
  if (token)
    db.query("DELETE FROM sessions WHERE hash=?").run(hashToken(token));
}
export interface Settings {
  mqttBroker: string;
  mqttUser: string;
  mqttPassword: string;
  mqttPrefix: string;
}
export function settings(): Settings {
  return (
    getConfig<Settings>("settings") || {
      mqttBroker: "",
      mqttUser: "",
      mqttPassword: "",
      mqttPrefix: "homeassistant",
    }
  );
}
