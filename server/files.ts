import { Client, FileType } from "basic-ftp";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import archiver from "archiver";
import Busboy from "busboy";
import type { Credentials } from "./store";

export class FileError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function remotePath(value: unknown, allowRoot = true): string {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    value.split("/").includes("..")
  )
    throw new FileError(400, "Invalid printer file path.");
  const path = posix.normalize("/" + value.replace(/^\/+/, ""));
  if (!allowRoot && path === "/")
    throw new FileError(400, "Select a file or folder; the storage root cannot be modified.");
  return path;
}
export async function ftp(credentials: Credentials): Promise<Client> {
  const client = new Client(30000);
  try {
    await client.access({
      host: credentials.host,
      port: 990,
      user: "bblp",
      password: credentials.code,
      secure: "implicit",
      secureOptions: { rejectUnauthorized: false },
    });
    return client;
  } catch {
    client.close();
    throw new FileError(
      502,
      "Printer storage is unavailable. Check LAN access, the access code, and SD card.",
    );
  }
}
export async function withFTP<T>(
  credentials: Credentials,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await ftp(credentials);
  try {
    return await action(client);
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError(
      502,
      "Printer storage operation failed. Check the path, SD card, and available space.",
    );
  } finally {
    client.close();
  }
}
export async function listFiles(credentials: Credentials, path: string) {
  return withFTP(credentials, async (client) =>
    (await client.list(remotePath(path))).map((file) => ({
      Name: file.name,
      Size: file.size,
      Type: file.type === FileType.Directory ? "dir" : "file",
      Modified: file.modifiedAt?.toISOString() || file.rawModifiedAt,
    })),
  );
}
function attachment(name: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}
export async function download(credentials: Credentials, path: string, signal: AbortSignal) {
  path = remotePath(path, false);
  const client = await ftp(credentials);
  const output = new PassThrough();
  const abort = () => {
    client.close();
    output.destroy(new Error("Download cancelled"));
  };
  signal.addEventListener("abort", abort, { once: true });
  output.on("error", () => {});
  output.on("close", () => client.close());
  void client
    .downloadTo(output, path)
    .then(
      () => output.end(),
      () => output.destroy(new Error("Printer download failed")),
    )
    .finally(() => {
      signal.removeEventListener("abort", abort);
      client.close();
    });
  return new Response(Readable.toWeb(output) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachment(posix.basename(path)),
      "Cache-Control": "no-store",
    },
  });
}
export async function modify(
  credentials: Credentials,
  action: string,
  fields: Record<string, unknown>,
) {
  await withFTP(credentials, async (client) => {
    if (action === "rename")
      await client.rename(remotePath(fields.oldPath, false), remotePath(fields.newPath, false));
    else if (action === "mkdir") await client.ensureDir(remotePath(fields.path, false));
    else {
      const path = remotePath(fields.file ?? fields.path, false);
      const parent = await client.list(posix.dirname(path));
      const file = parent.find((entry) => entry.name === posix.basename(path));
      if (!file) throw new FileError(404, "The file or folder was not found.");
      if (file.type === FileType.Directory) await client.removeDir(path);
      else await client.remove(path);
    }
  });
}
export interface Multipart {
  fields: Record<string, string>;
  file?: { path: string; name: string; size: number };
  cleanup(): Promise<void>;
}
export async function multipart(request: Request): Promise<Multipart> {
  if (!request.body) throw new FileError(400, "Multipart data is required.");
  const directory = await mkdtemp(join(tmpdir(), "bambudeck-upload-"));
  const result: Multipart = {
    fields: {},
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
  try {
    const parser = Busboy({
      headers: { "content-type": request.headers.get("content-type") || "" },
      limits: {
        files: 1,
        fields: 40,
        fieldSize: 4096,
        fileSize: 1024 * 1024 * 1024,
        parts: 41,
      },
    });
    const writes: Promise<void>[] = [];
    let error: Error | undefined;
    parser.on("field", (name, value, info) => {
      if (info.valueTruncated) error = new FileError(413, "Form field is too large.");
      else result.fields[name] = value;
    });
    parser.on("file", (field, stream, info) => {
      if (field !== "file") {
        error = new FileError(400, "Unexpected file field.");
        stream.resume();
        return;
      }
      const filename = posix.basename((info.filename || "").replaceAll("\\", "/"));
      if (!filename || filename === "." || filename === "..") {
        error = new FileError(400, "Invalid filename.");
        stream.resume();
        return;
      }
      const path = join(directory, "upload");
      result.file = { path, name: filename, size: 0 };
      stream.on("limit", () => {
        error = new FileError(413, "Uploads are limited to 1 GiB.");
      });
      writes.push(
        pipeline(stream, createWriteStream(path, { mode: 0o600 })).catch(() => {
          error = new FileError(
            500,
            "Could not store the incoming upload. Check temporary disk space.",
          );
        }),
      );
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const)
      parser.on(event, () => {
        error = new FileError(413, "Too many multipart fields or files.");
      });
    await pipeline(
      Readable.fromWeb(request.body as unknown as import("node:stream/web").ReadableStream),
      parser,
      { signal: request.signal },
    );
    await Promise.all(writes);
    if (error) throw error;
    if (result.file) result.file.size = (await stat(result.file.path)).size;
    return result;
  } catch (error) {
    await result.cleanup();
    if (error instanceof FileError) throw error;
    throw new FileError(400, "Could not read multipart upload.");
  }
}
export async function upload(
  credentials: Credentials,
  file: NonNullable<Multipart["file"]>,
  directory: string,
  progress: (bytes: number, total: number) => void,
  signal?: AbortSignal,
) {
  const path = remotePath(posix.join(remotePath(directory), file.name), false);
  await withFTP(credentials, async (client) => {
    const abort = () => client.close();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      client.close();
      throw new FileError(499, "Upload cancelled.");
    }
    client.trackProgress((info) => progress(info.bytesOverall, file.size));
    try {
      await client.uploadFrom(file.path, path);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
  return path;
}
export async function archive(credentials: Credentials, directory: string, signal: AbortSignal) {
  directory = remotePath(directory);
  const client = await ftp(credentials);
  const zip = archiver("zip", { zlib: { level: 1 } });
  const output = new PassThrough();
  output.on("error", () => {});
  zip.on("error", () => {
    output.destroy(new Error("Archive failed"));
    client.close();
  });
  zip.pipe(output);
  const abort = () => {
    zip.abort();
    output.destroy();
    client.close();
  };
  output.on("close", abort);
  signal.addEventListener("abort", abort, { once: true });
  let count = 0;
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 20) throw new FileError(413, "Folder depth exceeds archive limit.");
    for (const entry of await client.list(path)) {
      if (signal.aborted) throw new Error("Cancelled");
      if (++count > 10000) throw new FileError(413, "Archive exceeds 10,000 entries.");
      const full = remotePath(posix.join(path, entry.name));
      const name = posix.relative(directory, full);
      if (name.startsWith("../") || entry.name.includes("/")) continue;
      if (entry.type === FileType.Directory) {
        zip.append("", { name: name + "/" });
        await visit(full, depth + 1);
      } else if (entry.type === FileType.File) {
        const stream = new PassThrough();
        zip.append(stream, { name });
        try {
          await client.downloadTo(stream, full);
          stream.end();
        } catch (error) {
          stream.destroy();
          throw error;
        }
      }
    }
  };
  void visit(directory, 0)
    .then(() => zip.finalize())
    .catch(() => output.destroy(new Error("Printer archive failed")))
    .finally(() => {
      client.close();
      signal.removeEventListener("abort", abort);
    });
  return new Response(Readable.toWeb(output) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachment((posix.basename(directory) || "printer-storage") + ".zip"),
      "Cache-Control": "no-store",
    },
  });
}
