import { parse } from "./validation";
import { previewQuerySchema } from "./printers/model";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { open, type ZipFile, type Entry } from "yauzl";
import { FileError, ftp, remotePath } from "./files";
import { resolvePrintFile } from "./metadata";
import type { Printer } from "./store";

type Point = [number, number, number];
type Preview = {
  directory: string;
  layers: { z: number; count: number }[];
  bounds: { min: Point; max: Point };
  model: number[];
  warnings: string[];
};
type CachedPreview = {
  expires: number;
  work: Promise<Preview>;
  users: number;
  ready: boolean;
  invalidated?: boolean;
};
const cache = new Map<string, CachedPreview>();
function removeCached(key: string, item: CachedPreview) {
  if (cache.get(key) === item) cache.delete(key);
  void item.work
    .then((value) => rm(value.directory, { recursive: true, force: true }))
    .catch(() => {});
}
export function invalidatePreview(printerId: string) {
  for (const [key, item] of cache)
    if (JSON.parse(key)[0] === printerId) {
      item.invalidated = true;
      cache.delete(key);
      if (item.users === 0) removeCached(key, item);
    }
}
const cleanup = setInterval(() => {
  for (const [key, item] of cache)
    if (item.ready && item.users === 0 && item.expires < Date.now()) removeCached(key, item);
}, 60000);
cleanup.unref();
let building = 0;
const MAX_BYTES = 512 * 1024 * 1024;
function limitBytes(limit: number) {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(
        bytes > limit ? new FileError(413, "Preview file exceeds the size limit.") : null,
        chunk,
      );
    },
  });
}
async function gcodeStream(
  path: string,
  plate: number,
): Promise<{ stream: Readable; close: () => void }> {
  if (!/\.3mf$/i.test(path)) {
    const stream = createReadStream(path);
    return { stream, close: () => stream.destroy() };
  }
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    open(path, { lazyEntries: true, validateEntrySizes: true }, (error, archive) =>
      error || !archive
        ? reject(new FileError(400, "The 3MF archive could not be opened."))
        : resolve(archive),
    );
  });
  return new Promise((resolve, reject) => {
    let entries = 0;
    const fail = (error: unknown) => {
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", () =>
      fail(
        new FileError(
          404,
          `Plate ${plate} has no sliced G-code. Slice the project before previewing layers.`,
        ),
      ),
    );
    zip.on("entry", (entry: Entry) => {
      if (++entries > 20000)
        return fail(new FileError(413, "3MF archive contains too many entries."));
      if (entry.fileName.toLowerCase() !== `metadata/plate_${plate}.gcode`) return zip.readEntry();
      if (entry.uncompressedSize > MAX_BYTES * 2)
        return fail(new FileError(413, "Sliced G-code exceeds the 1 GiB preview limit."));
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(new FileError(400, "Sliced G-code could not be read."));
        resolve({
          stream,
          close: () => {
            stream.destroy();
            zip.close();
          },
        });
      });
    });
    zip.readEntry();
  });
}
async function* lines(stream: Readable) {
  let pending = "",
    bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES * 2)
      throw new FileError(413, "Sliced G-code exceeds the 1 GiB preview limit.");
    pending += chunk.toString();
    let end: number;
    while ((end = pending.indexOf("\n")) !== -1) {
      if (end > 65536) throw new FileError(413, "G-code line is too long.");
      yield pending.slice(0, end);
      pending = pending.slice(end + 1);
    }
    if (pending.length > 65536) throw new FileError(413, "G-code line is too long.");
  }
  if (pending) yield pending;
}
export async function parseToolpath(
  path: string,
  plate: number,
  directory: string,
): Promise<Preview> {
  const source = await gcodeStream(path, plate);
  const result: Preview = {
    directory,
    layers: [],
    bounds: {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
    model: [],
    warnings: [],
  };
  const warn = (message: string) => {
    if (!result.warnings.includes(message)) result.warnings.push(message);
  };
  let position: Point = [0, 0, 0],
    extrusion = 0,
    absolute = true,
    absoluteE = true,
    scale = 1;
  let pendingLayer = false,
    markedLayers = false,
    layerZ = 0,
    segments: number[] = [],
    total = 0,
    sampleStride = 1;
  let plane = 17,
    absoluteArc = false,
    conditionalDepth = 0;
  const flush = async () => {
    if (!segments.length) return;
    if (result.layers.length >= 20000) throw new FileError(413, "Preview exceeds 20,000 layers.");
    const data = new Float32Array(segments);
    await writeFile(
      join(directory, `${result.layers.length + 1}.bin`),
      new Uint8Array(data.buffer),
      { mode: 0o600 },
    );
    result.layers.push({ z: layerZ, count: segments.length / 6 });
    segments = [];
  };
  const add = (from: Point, to: Point) => {
    if (from.every((value, index) => value === to[index])) return;
    if (++total > 8000000 || segments.length >= 900000)
      throw new FileError(413, "Toolpath is too complex for preview.");
    const segment = [...from, ...to];
    segments.push(...segment);
    for (const point of [from, to])
      for (let axis = 0; axis < 3; axis++) {
        result.bounds.min[axis] = Math.min(result.bounds.min[axis]!, point[axis]!);
        result.bounds.max[axis] = Math.max(result.bounds.max[axis]!, point[axis]!);
      }
    if (total % sampleStride === 0) result.model.push(...segment);
    if (result.model.length > 360000) {
      result.model = result.model.filter((_value, index) => Math.floor(index / 6) % 2 === 0);
      sampleStride *= 2;
      warn("The 3D overview is simplified; the selected layer retains its full toolpath.");
    }
  };
  try {
    for await (const raw of lines(source.stream)) {
      if (
        /^\s*;\s*(?:CHANGE_LAYER|LAYER_CHANGE|LAYER:\s*\d+|layer num\/total_layer_count\s*:)/i.test(
          raw,
        )
      ) {
        if (!markedLayers) {
          result.layers = [];
          result.model = [];
          result.bounds = {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity],
          };
          segments = [];
          total = 0;
          sampleStride = 1;
        }
        pendingLayer = true;
        markedLayers = true;
      }
      const command = raw
        .split(";")[0]!
        .trim()
        .replace(/^N\d+\s*/, "");
      const code = command.match(/^([GMT]\d+(?:\.\d+)?)/i)?.[1]?.toUpperCase();
      if (!code) continue;
      const fields: Record<string, number> = {};
      for (const match of command
        .slice(code.length)
        .matchAll(/([A-Z])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/gi))
        fields[match[1]!.toUpperCase()] = Number(match[2]);
      if (code === "G90") absolute = true;
      else if (code === "G91") absolute = false;
      else if (code === "M82") absoluteE = true;
      else if (code === "M83") absoluteE = false;
      else if (code === "G20") scale = 25.4;
      else if (code === "G21") scale = 1;
      else if (code === "G90.1") absoluteArc = true;
      else if (code === "G91.1") absoluteArc = false;
      else if (["G17", "G18", "G19"].includes(code)) plane = Number(code.slice(1));
      else if (code === "M622") {
        conditionalDepth++;
        warn("Conditional firmware commands cannot be evaluated; paths show planned G-code.");
      } else if (code === "M623") conditionalDepth = Math.max(0, conditionalDepth - 1);
      else if (code === "G92") {
        for (const [index, axis] of ["X", "Y", "Z"].entries())
          if (fields[axis] !== undefined) position[index] = fields[axis]! * scale;
        if (fields.E !== undefined) extrusion = fields.E * scale;
      } else if (["G0", "G00", "G1", "G01", "G2", "G02", "G3", "G03"].includes(code)) {
        const next = position.map((value, index) => {
          const coordinate = fields[["X", "Y", "Z"][index]!];
          return coordinate === undefined ? value : coordinate * scale + (absolute ? 0 : value);
        }) as Point;
        if (next.some((value) => !Number.isFinite(value) || Math.abs(value) > 100000))
          throw new FileError(400, "G-code coordinates are outside preview limits.");
        const nextE =
          fields.E === undefined ? extrusion : fields.E * scale + (absoluteE ? 0 : extrusion);
        if (nextE > extrusion + 0.000001 && conditionalDepth === 0) {
          if (pendingLayer || (!markedLayers && segments.length && next[2] > layerZ + 0.001))
            await flush();
          if (!segments.length) layerZ = next[2];
          pendingLayer = false;
          const arc = /^G0?[23]$/.test(code);
          if (!arc) add(position, next);
          else if (
            plane !== 17 ||
            absoluteArc ||
            fields.R !== undefined ||
            (fields.I === undefined && fields.J === undefined)
          ) {
            warn("Unsupported arc commands were omitted from the preview.");
          } else {
            const cx = position[0] + (fields.I || 0) * scale,
              cy = position[1] + (fields.J || 0) * scale;
            const radius = Math.hypot(position[0] - cx, position[1] - cy);
            if (radius === 0 || Math.abs(Math.hypot(next[0] - cx, next[1] - cy) - radius) > 0.1) {
              warn("Invalid arc commands were omitted from the preview.");
              position = next;
              extrusion = nextE;
              continue;
            }
            const start = Math.atan2(position[1] - cy, position[0] - cx);
            let angle = Math.atan2(next[1] - cy, next[0] - cx) - start;
            if (Number(code.slice(1)) === 2) {
              if (angle >= 0) angle -= 2 * Math.PI;
            } else if (angle <= 0) angle += 2 * Math.PI;
            const steps = Math.min(512, Math.max(2, Math.ceil((Math.abs(angle) * radius) / 0.5)));
            let previous = position;
            for (let step = 1; step <= steps; step++) {
              const t = step / steps;
              const point: Point =
                step === steps
                  ? next
                  : [
                      cx + Math.cos(start + angle * t) * radius,
                      cy + Math.sin(start + angle * t) * radius,
                      position[2] + (next[2] - position[2]) * t,
                    ];
              add(previous, point);
              previous = point;
            }
          }
        }
        position = next;
        extrusion = nextE;
      }
    }
    await flush();
    if (!markedLayers)
      warn(
        "Layer boundaries are estimated from extrusion height because this file has no layer markers.",
      );
    if (!result.layers.length)
      throw new FileError(422, "No printable extrusion paths were found in this file.");
    return result;
  } finally {
    source.close();
  }
}
async function build(profile: Printer, file: string, plate: number): Promise<Preview> {
  const directory = await mkdtemp(join(tmpdir(), "bambudeck-preview-"));
  const path = join(directory, /\.3mf$/i.test(file) ? "source.3mf" : "source.gcode");
  try {
    const client = await ftp(profile);
    try {
      if ((await client.size(file)) > MAX_BYTES)
        throw new FileError(413, "Preview files are limited to 512 MiB.");
      const limiter = limitBytes(MAX_BYTES);
      let writeError: unknown;
      const writing = pipeline(limiter, createWriteStream(path, { mode: 0o600 })).catch((error) => {
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
    } finally {
      client.close();
    }
    const result = await parseToolpath(path, plate, directory);
    await rm(path, { force: true });
    return result;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error instanceof FileError) throw error;
    throw new FileError(502, "Could not load the sliced file from printer storage.");
  }
}
export async function preview(
  profile: Printer,
  print: Record<string, unknown>,
  query: URLSearchParams,
) {
  const input = parse(previewQuerySchema, Object.fromEntries(query));
  const file = input.file
    ? remotePath(input.file, false)
    : await resolvePrintFile(profile, print, true);
  if (!file)
    throw new FileError(
      404,
      "Current print file was not found in printer storage. Select its sliced 3MF or G-code file from Files.",
    );
  if (!/\.(3mf|gcode)$/i.test(file))
    throw new FileError(400, "Layer preview requires sliced 3MF or G-code.");
  const plate = Number(
    input.plate ||
      (!input.file && String(print.gcode_file || "").match(/plate_(\d+)\.gcode/i)?.[1]) ||
      1,
  );
  if (!Number.isInteger(plate) || plate < 1 || plate > 10000)
    throw new FileError(400, "Invalid plate number.");
  const key = JSON.stringify([profile.id, file, plate, print.task_id, print.subtask_id]);
  let item = cache.get(key);
  if (!item) {
    if (cache.size >= 4) {
      const oldest = [...cache]
        .filter(([, value]) => value.ready && value.users === 0)
        .sort((a, b) => a[1].expires - b[1].expires)[0];
      if (oldest) removeCached(oldest[0], oldest[1]);
    }
    if (building >= 2 || cache.size >= 4)
      throw new FileError(429, "Preview capacity is busy. Try again shortly.");
    building++;
    const work = build(profile, file, plate)
      .catch((error) => {
        if (cache.get(key)?.work === work) cache.delete(key);
        throw error;
      })
      .finally(() => {
        building--;
      });
    item = { work, expires: Date.now() + 15 * 60000, users: 0, ready: false };
    const entry = item;
    void work
      .then(() => {
        entry.ready = true;
      })
      .catch(() => {});
    cache.set(key, item);
  }
  item.users++;
  try {
    const data = await item.work;
    item.expires = Date.now() + 15 * 60000;
    const requestedLayer = Number(input.layer || print.layer_num || 1);
    if (!Number.isInteger(requestedLayer) || requestedLayer < 1)
      throw new FileError(400, "Invalid layer number.");
    const layer = Math.min(requestedLayer, data.layers.length);
    const bytes = await readFile(join(data.directory, `${layer}.bin`));
    const values = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    return {
      kind: "toolpath",
      filename: file,
      plate,
      layer,
      layerCount: data.layers.length,
      z: data.layers[layer - 1]!.z,
      bounds: data.bounds,
      segments: Array.from(values),
      model: input.model === "0" ? undefined : data.model,
      warnings: data.warnings,
    };
  } finally {
    item.users--;
    if (item.invalidated && item.users === 0) removeCached(key, item);
  }
}
