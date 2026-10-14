import { open, type ZipFile, type Entry } from "yauzl";
import { XMLParser } from "fast-xml-parser";
import { mkdtemp, rm, readdir, readFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileError, ftp, remotePath } from "./files";
import type { Credentials } from "./store";

type Values = Record<string, unknown>;
export interface Metadata {
  filename: string;
  plates: Values[];
  filaments: Values[];
  project: Values;
  thumbnails: Map<string, Buffer>;
}
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
  allowBooleanAttributes: true,
});
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
function xmlMetadata(value: unknown): Values {
  if (!value || typeof value !== "object") return {};
  const entries = array(
    (value as Values).metadata as Values | Values[] | undefined,
  );
  return Object.fromEntries(
    entries
      .filter(
        (item) =>
          typeof item.key === "string" &&
          !["__proto__", "constructor", "prototype"].includes(item.key),
      )
      .map((item) => [item.key, item.value]),
  );
}
function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    open(
      path,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (error, zip) => (error || !zip ? reject(error) : resolve(zip)),
    ),
  );
}
function entryBytes(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error);
        return;
      }
      const chunks: Buffer[] = [];
      let count = 0;
      stream.on("data", (chunk: Buffer) => {
        count += chunk.length;
        if (count > 8 * 1024 * 1024)
          stream.destroy(
            new FileError(413, "3MF metadata entry is too large."),
          );
        else chunks.push(chunk);
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    }),
  );
}
export async function parse3mf(
  path: string,
  filename: string,
): Promise<Metadata> {
  const zip = await openZip(path).catch(() => {
    throw new FileError(
      400,
      "The selected file is not a readable 3MF archive.",
    );
  });
  const result: Metadata = {
    filename,
    plates: [],
    filaments: [],
    project: {},
    thumbnails: new Map(),
  };
  let entries = 0,
    expanded = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          if (++entries > 20000)
            throw new FileError(413, "3MF contains too many entries.");
          const name = entry.fileName;
          if (
            !/^Metadata\/(slice_info\.config|model_settings\.config|project_settings\.config|plate_\d+(?:_small)?\.png)$/i.test(
              name,
            )
          ) {
            zip.readEntry();
            return;
          }
          expanded += entry.uncompressedSize;
          if (
            entry.uncompressedSize > 8 * 1024 * 1024 ||
            expanded > 32 * 1024 * 1024 ||
            (entry.compressedSize > 0 &&
              entry.uncompressedSize / entry.compressedSize > 200)
          )
            throw new FileError(
              413,
              "3MF metadata exceeds safe extraction limits.",
            );
          const bytes = await entryBytes(zip, entry);
          if (/\.png$/i.test(name)) result.thumbnails.set(name, bytes);
          else if (name.endsWith("project_settings.config")) {
            try {
              const data: unknown = JSON.parse(bytes.toString());
              if (data && typeof data === "object" && !Array.isArray(data))
                result.project = data as Values;
            } catch {}
          } else {
            const root = parser.parse(bytes.toString()) as {
              config?: { plate?: Values | Values[] };
            };
            for (const plate of array(root.config?.plate)) {
              const fields = xmlMetadata(plate);
              const index = Number(
                fields.index ??
                  (fields.plater_id !== undefined
                    ? Number(fields.plater_id) + 1
                    : result.plates.length + 1),
              );
              let item = result.plates.find((p) => Number(p.index) === index);
              if (!item) {
                item = { index };
                result.plates.push(item);
              }
              Object.assign(item, fields, { index });
              const filaments = array(
                plate.filament as Values | Values[] | undefined,
              );
              if (filaments.length) {
                item.filaments = filaments;
                result.filaments.push(
                  ...filaments.map((f) => ({ ...f, plate: index })),
                );
              }
              const objects = array(
                plate.object as Values | Values[] | undefined,
              );
              if (objects.length) item.objects = objects;
            }
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    for (const [name] of result.thumbnails) {
      const index = Number(name.match(/plate_(\d+)/)?.[1]);
      let plate = result.plates.find((item) => Number(item.index) === index);
      if (!plate) {
        plate = { index };
        result.plates.push(plate);
      }
      if (!plate.thumbnail || name.includes("_small")) plate.thumbnail = name;
    }
    return result;
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError(400, "Could not read the 3MF metadata.");
  } finally {
    zip.close();
  }
}
export async function loadMetadata(
  credentials: Credentials,
  file: string,
): Promise<Metadata> {
  file = remotePath(file, false);
  if (!/\.3mf$/i.test(file))
    return {
      filename: file,
      plates: [],
      filaments: [],
      project: {},
      thumbnails: new Map(),
    };
  const client = await ftp(credentials);
  const directory = await mkdtemp(join(tmpdir(), "bambudeck-metadata-")).catch(
    (error) => {
      client.close();
      throw error;
    },
  );
  const path = join(directory, "project.3mf");
  try {
    const size = await client.size(file);
    if (size > 512 * 1024 * 1024)
      throw new FileError(
        413,
        "Metadata extraction is limited to 512 MiB 3MF files.",
      );
    let total = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        callback(
          total > 512 * 1024 * 1024
            ? new FileError(413, "3MF file is too large.")
            : null,
          chunk,
        );
      },
    });
    let writeError: unknown;
    const writing = pipeline(
      limiter,
      createWriteStream(path, { mode: 0o600 }),
    ).catch((error) => {
      writeError = error;
      client.close();
    });
    try {
      await client.downloadTo(limiter, file);
      limiter.end();
      await writing;
      if (writeError) throw writeError;
    } catch (error) {
      limiter.destroy();
      await writing;
      throw error;
    }
    return await parse3mf(path, file);
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError(
      502,
      "Could not download 3MF metadata from printer storage.",
    );
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
}
export function publicMetadata(metadata: Metadata) {
  const plates = metadata.plates.map((plate) => ({
    ...plate,
    id: Number(plate.index),
    name: String(plate.name || plate.plate_name || `Plate ${plate.index}`),
  }));
  return {
    filename: metadata.filename,
    metadata: {
      plates,
      filaments: metadata.filaments,
      project: metadata.project,
    },
    plates,
    filaments: metadata.filaments,
  };
}

let profileCache: { until: number; values: Values[] } | undefined;
export async function filamentProfiles(query: string) {
  if (!profileCache || profileCache.until < Date.now()) {
    const root = process.env.BAMBUDECK_FILAMENT_DIR || "/data/filament-profiles";
    const documents = new Map<string, Values>();
    let count = 0;
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++count > 15000)
          throw new FileError(
            413,
            "Filament profile directory has too many entries.",
          );
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".json")) {
          if ((await stat(path)).size > 1024 * 1024) continue;
          try {
            const value: unknown = JSON.parse(await readFile(path, "utf8"));
            if (value && typeof value === "object" && !Array.isArray(value)) {
              const data = value as Values;
              documents.set(String(data.name || entry.name.slice(0, -5)), data);
            }
          } catch {}
        }
      }
    };
    try {
      await visit(root, 0);
    } catch (error) {
      if (error instanceof FileError) throw error;
      throw new FileError(
        503,
        "Mount Bambu Studio filament JSON profiles in /data/filament-profiles.",
      );
    }
    const scalar = (value: unknown): unknown =>
      Array.isArray(value) ? value[0] : value;
    const merge = (name: string, seen = new Set<string>()): Values => {
      const value = documents.get(name) || {};
      if (seen.has(name) || seen.size > 20) return value;
      seen.add(name);
      const parent = typeof value.inherits === "string" ? value.inherits : "";
      return { ...(parent ? merge(parent, seen) : {}), ...value };
    };
    const values = [...documents.keys()]
      .map((name) => {
        const p = merge(name);
        return {
          Name: name,
          ID: scalar(p.filament_id) || "",
          SettingID:
            scalar(p.setting_id) || scalar(p.filament_settings_id) || "",
          Type: scalar(p.filament_type) || "",
          TempMin: Number(scalar(p.nozzle_temperature_range_low) || 190),
          TempMax: Number(scalar(p.nozzle_temperature_range_high) || 230),
          Color: scalar(p.filament_colour) || "",
          inherits: p.inherits || "",
        };
      })
      .filter((item) => item.ID || item.Type);
    profileCache = { until: Date.now() + 60000, values };
  }
  const needle = query.toLowerCase().slice(0, 200);
  return profileCache.values
    .filter((item) =>
      `${item.Name} ${item.ID} ${item.Type}`.toLowerCase().includes(needle),
    )
    .slice(0, 250);
}
