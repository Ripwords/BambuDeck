import { PrinterClient, PrinterError } from "./printer";
import { printers, settings, type Printer } from "./store";
import {
  FileError,
  listFiles,
  download,
  modify,
  multipart,
  upload,
  archive,
  remotePath,
} from "./files";
import {
  loadMetadata,
  publicMetadata,
  filamentProfiles,
  type Metadata,
} from "./metadata";
import {
  startHomeAssistant,
  stopHomeAssistant,
  attachHomeAssistant,
  detachHomeAssistant,
} from "./homeassistant";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
interface Session {
  client: PrinterClient;
  profile: Printer;
  metadata?: Metadata;
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
function status(session: Session) {
  return {
    ...session.client.status(),
    metadata: session.metadata ? publicMetadata(session.metadata) : null,
    upload_status: session.upload,
  };
}
function emit(session: Session) {
  const value = status(session);
  for (const listener of session.listeners) listener(value);
}
async function metadataFor(session: Session, path: string): Promise<Metadata> {
  if (session.metadata?.filename === path) return session.metadata;
  if (session.metadataLoading) {
    if (session.metadataLoading.path === path)
      return session.metadataLoading.work;
    throw new ApiError(
      409,
      "Another file's metadata is loading. Try again shortly.",
    );
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
      new ApiError(
        503,
        "Printer connections are restarting. Try again shortly.",
      ),
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
        throw new ApiError(
          409,
          "Printer profile changed while connecting. Reconnect to continue.",
        );
      }
      const session: Session = {
        client,
        profile,
        upload: {},
        listeners: new Set(),
        streams: new Set(),
        unsubscribe: () => {},
      };
      session.unsubscribe = client.subscribe((value) => {
        emit(session);
        const print = value.print as Record<string, unknown> | undefined;
        const filename = [print?.gcode_file, print?.subtask_name].find(
          (path) => typeof path === "string" && /\.3mf$/i.test(path),
        );
        if (
          typeof filename === "string" &&
          !session.metadataLoading &&
          (session.metadataRetry || 0) < Date.now()
        ) {
          let path: string;
          try {
            path = remotePath(filename, false);
          } catch {
            return;
          }
          if (session.metadata?.filename !== path)
            void metadataFor(session, path)
              .then(() => emit(session))
              .catch(() => {
                session.metadataRetry = Date.now() + 60000;
              });
        }
      });
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
          console.info(
            "A saved printer is offline; reconnect from the dashboard.",
          ),
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
function json(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}
async function fields(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 65536)
    throw new ApiError(413, "Command is too large.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.length;
        if (bytes > 65536) {
          await reader.cancel();
          throw new ApiError(413, "Command is too large.");
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const text = Buffer.concat(chunks).toString();
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "A JSON command object is required.");
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}
function events(request: Request, session: Session) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const send = (value: Record<string, unknown>) => {
        if (ended) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: status_update\ndata: ${JSON.stringify(value)}\n\n`,
            ),
          );
        } catch {
          stop();
        }
      };
      const timer = setInterval(() => {
        if (!ended) {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            stop();
          }
        }
      }, 15000);
      stop = () => {
        if (ended) return;
        ended = true;
        clearInterval(timer);
        session.listeners.delete(send);
        session.streams.delete(stop);
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {}
      };
      session.streams.add(stop);
      request.signal.addEventListener("abort", stop, { once: true });
      session.listeners.add(send);
      send(status(session));
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
function camera(request: Request, session: Session) {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const frame = await session.client.camera.snapshot(abort.signal);
        controller.enqueue(
          encoder.encode(
            `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
          ),
        );
        controller.enqueue(new Uint8Array(frame));
        controller.enqueue(encoder.encode("\r\n"));
        await Bun.sleep(200);
      } catch {
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
      request.signal.removeEventListener("abort", onAbort);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
const methods: Record<string, string> = {
  status: "GET",
  events: "GET",
  camera: "GET",
  snapshot: "GET",
  files: "GET",
  download: "GET",
  archive: "GET",
  thumbnail: "GET",
  metadata: "GET",
  profiles: "GET",
  control: "POST",
  filament: "POST",
  advanced: "POST",
  upload: "POST",
  print: "POST",
  delete: "POST",
  rename: "POST",
  mkdir: "POST",
};
export async function proxy(
  request: Request,
  profile: Printer,
  endpoint: string,
): Promise<Response> {
  if (!methods[endpoint]) throw new ApiError(404, "Unknown printer endpoint.");
  if (request.method !== methods[endpoint])
    throw new ApiError(405, "Method not allowed.");
  if (endpoint === "profiles") {
    try {
      return json(
        await filamentProfiles(
          new URL(request.url).searchParams.get("q") || "",
        ),
      );
    } catch (error) {
      if (error instanceof FileError)
        throw new ApiError(error.status, error.message);
      throw error;
    }
  }
  const session = await connect(profile);
  const query = new URL(request.url).searchParams;
  try {
    if (endpoint === "status") return json(status(session));
    if (endpoint === "events") return events(request, session);
    if (endpoint === "camera") return camera(request, session);
    if (endpoint === "snapshot") {
      try {
        return new Response(
          new Uint8Array(await session.client.camera.snapshot(request.signal)),
          {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "no-store",
            },
          },
        );
      } catch {
        throw new ApiError(
          503,
          "Camera unavailable. Check LAN camera access and printer streaming settings.",
        );
      }
    }
    if (endpoint === "files")
      return json(
        await listFiles(profile, query.get("path") || query.get("dir") || "/"),
      );
    if (endpoint === "download")
      return download(
        profile,
        query.get("path") || query.get("file") || "",
        request.signal,
      );
    if (endpoint === "archive")
      return archive(profile, query.get("path") || "/", request.signal);
    if (endpoint === "metadata" || endpoint === "thumbnail") {
      const thumbKey = query.get("key") || "";
      const keyedFile = thumbKey.match(/^(.*)\/(\d+)$/);
      const path = remotePath(
        query.get("file") || keyedFile?.[1] || session.metadata?.filename || "",
        false,
      );
      session.metadata = await metadataFor(session, path);
      if (endpoint === "metadata") {
        emit(session);
        return json(publicMetadata(session.metadata));
      }
      const plate = query.get("plate") || keyedFile?.[2] || "1",
        size = query.get("size") === "large" ? "" : "_small";
      const image =
        session.metadata.thumbnails.get(thumbKey) ||
        session.metadata.thumbnails.get(`Metadata/plate_${plate}${size}.png`) ||
        session.metadata.thumbnails.get(`Metadata/plate_${plate}.png`);
      if (!image)
        throw new ApiError(
          404,
          "This file has no thumbnail for the selected plate.",
        );
      return new Response(new Uint8Array(image), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    }
    if (["control", "filament", "advanced"].includes(endpoint)) {
      const data = await fields(request);
      try {
        return json(await session.client.command(data));
      } catch (error) {
        if (error instanceof PrinterError)
          throw new ApiError(error.status, error.message);
        throw new ApiError(400, "Invalid printer command.");
      }
    }
    if (["delete", "rename", "mkdir"].includes(endpoint)) {
      await modify(profile, endpoint, await fields(request));
      session.metadata = undefined;
      return json({ ok: true });
    }
    if (endpoint === "upload" || endpoint === "print") {
      if (session.uploading)
        throw new ApiError(
          409,
          "Another upload or print request is in progress for this printer.",
        );
      session.uploading = true;
      let form: Awaited<ReturnType<typeof multipart>> | undefined;
      try {
        form = await multipart(request);
        let path =
          form.fields.existing_path ||
          form.fields.filepath ||
          form.fields.filename ||
          form.fields.path ||
          "";
        if (form.file) {
          const file = form.file;
          session.upload = {
            uploading: true,
            filename: file.name,
            percent: 0,
            current: 0,
            total: file.size,
          };
          emit(session);
          path = await upload(
            profile,
            file,
            endpoint === "upload" ? form.fields.path || "/" : "/",
            (bytes, total) => {
              session.upload = {
                uploading: true,
                filename: file.name,
                current: bytes,
                total,
                percent: total ? Math.round((bytes / total) * 100) : 0,
              };
              emit(session);
            },
            request.signal,
          );
          session.metadata = undefined;
        } else if (endpoint === "upload")
          throw new ApiError(400, "Select a file to upload.");
        if (endpoint === "print") {
          try {
            return json(
              await session.client.startPrint(
                remotePath(path, false),
                form.fields,
              ),
            );
          } catch (error) {
            if (error instanceof FileError) throw error;
            if (error instanceof PrinterError)
              throw new ApiError(error.status, error.message);
            throw new ApiError(
              400,
              "Could not start print. Check its options.",
            );
          }
        }
        return json({ ok: true, path });
      } finally {
        session.uploading = false;
        session.upload = {};
        emit(session);
        await form?.cleanup();
      }
    }
    throw new ApiError(404, "Unknown printer endpoint.");
  } catch (error) {
    if (error instanceof FileError)
      throw new ApiError(error.status, error.message);
    throw error;
  }
}
