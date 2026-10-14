import { invalidatePreview } from "./preview";
import { PrinterClient } from "./printer";
import { printers, settings, type Printer } from "./store";
import { loadMetadata, publicMetadata, resolvePrintFile, type Metadata } from "./metadata";
import {
  startHomeAssistant,
  stopHomeAssistant,
  attachHomeAssistant,
  detachHomeAssistant,
} from "./mqtt-integration";
import { ApiError } from "./http";
export interface Session {
  client: PrinterClient;
  profile: Printer;
  metadata?: Metadata;
  printMetadata?: Metadata;
  printJob?: string;
  printMetadataLoading?: boolean;
  metadataLoading?: { path: string; work: Promise<Metadata> };
  metadataRetry?: number;
  uploading?: boolean;
  upload: Record<string, unknown>;
  listeners: Set<(value: Record<string, unknown>) => void>;
  streams: Set<() => void>;
  unsubscribe: () => void;
}
const clients = new Map<string, Session>();
const connecting = new Map<string, Promise<Session>>();
let lifecycle: Promise<void> = Promise.resolve();
let generation = 0,
  running = true;
export function engineReady() {
  return running;
}
export function status(session: Session) {
  return {
    ...session.client.status(),
    metadata: session.printMetadata ? publicMetadata(session.printMetadata) : null,
    upload_status: session.upload,
  };
}
export function emit(session: Session) {
  const value = status(session);
  for (const listener of session.listeners) listener(value);
}
export async function metadataFor(session: Session, path: string): Promise<Metadata> {
  if (session.printMetadata?.filename === path) return session.printMetadata;
  if (session.metadata?.filename === path) return session.metadata;
  if (session.metadataLoading) {
    if (session.metadataLoading.path === path) return session.metadataLoading.work;
    throw new ApiError(409, "Another file's metadata is loading. Try again shortly.");
  }
  const work = loadMetadata(session.profile, path)
    .then((value) => {
      session.metadata = value;
      return value;
    })
    .finally(() => {
      session.metadataLoading = undefined;
    });
  session.metadataLoading = { path, work };
  return work;
}
export function connect(profile: Printer): Promise<Session> {
  if (!running)
    return Promise.reject(
      new ApiError(503, "Printer connections are restarting. Try again shortly."),
    );
  const current = clients.get(profile.id);
  if (current) return Promise.resolve(current);
  const pending = connecting.get(profile.id);
  if (pending) return pending;
  const epoch = generation;
  const client = new PrinterClient(profile);
  let work!: Promise<Session>;
  work = (async () => {
    try {
      await client.connect();
      if (epoch !== generation || connecting.get(profile.id) !== work) {
        await client.close();
        throw new ApiError(409, "Printer profile changed while connecting. Reconnect to continue.");
      }
      const session: Session = {
        client,
        profile,
        upload: {},
        listeners: new Set(),
        streams: new Set(),
        unsubscribe: () => {},
      };
      const update = (value: Record<string, unknown>) => {
        const print = value.print as Record<string, unknown> | undefined;
        const job = JSON.stringify([
          print?.gcode_file,
          print?.subtask_name,
          print?.task_id,
          print?.subtask_id,
        ]);
        if (session.printJob !== job) {
          session.printJob = job;
          session.printMetadata = undefined;
          session.metadataRetry = 0;
        }
        emit(session);
        if (
          !print ||
          session.printMetadata ||
          session.printMetadataLoading ||
          (session.metadataRetry || 0) > Date.now()
        )
          return;
        session.printMetadataLoading = true;
        void resolvePrintFile(profile, print)
          .then(async (path) => {
            if (!path) return;
            const metadata = await metadataFor(session, path);
            if (session.printJob === job) {
              session.printMetadata = metadata;
              emit(session);
            }
          })
          .catch(() => {})
          .finally(() => {
            session.printMetadataLoading = false;
            if (session.printJob === job) session.metadataRetry = Date.now() + 60000;
          });
      };
      session.unsubscribe = client.subscribe(update);
      update(client.status());
      clients.set(profile.id, session);
      attachHomeAssistant(profile, client);
      return session;
    } catch (error) {
      await client.close();
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        502,
        "Could not connect to printer. Check LAN mode, IP address, serial number, access code, and network access.",
      );
    } finally {
      if (connecting.get(profile.id) === work) connecting.delete(profile.id);
    }
  })();
  connecting.set(profile.id, work);
  return work;
}
export async function forgetPrinter(id: string) {
  invalidatePreview(id);
  connecting.delete(id);
  const session = clients.get(id);
  clients.delete(id);
  detachHomeAssistant(id, true);
  if (session) {
    for (const stop of session.streams) stop();
    session.unsubscribe();
    session.listeners.clear();
    await session.client.close();
  }
}
export function restartEngine(): Promise<void> {
  const work = lifecycle.then(async () => {
    running = false;
    generation++;
    connecting.clear();
    await Promise.all([...clients.keys()].map(forgetPrinter));
    await stopHomeAssistant();
    await startHomeAssistant(settings());
    running = true;
    if (settings().mqttBroker)
      for (const profile of printers())
        void connect(profile).catch(() =>
          console.info("A saved printer is offline; reconnect from the dashboard."),
        );
  });
  lifecycle = work.catch(() => {
    running = true;
  });
  return work;
}
export async function shutdownEngine() {
  await lifecycle;
  running = false;
  generation++;
  connecting.clear();
  await Promise.all([...clients.keys()].map(forgetPrinter));
  await stopHomeAssistant();
}
