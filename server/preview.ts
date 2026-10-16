import { parse } from "./validation";
import { previewQuerySchema } from "./printers/model";
import { createReadStream, createWriteStream } from "node:fs";
import { open as openFile, mkdtemp, readFile, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { open, type ZipFile, type Entry } from "yauzl";
import { FileError, ftp, remotePath } from "./files";
import { resolvePrintFile } from "./metadata";
import type { Printer } from "./store";
import {
  TOOLPATH_ORIGIN,
  TOOLPATH_SEGMENT_BUDGET,
  TOOLPATH_VERSION,
  dequantize,
  encodeToolpathHeader,
  quantize,
  type Point,
  type ToolpathHeader,
  type ToolpathObject,
} from "../shared/toolpath";

type Preview = { directory: string; payload: string };
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
  requested: number | undefined,
): Promise<{ stream: Readable; close: () => void; plate: number }> {
  if (!/\.3mf$/i.test(path)) {
    const stream = createReadStream(path);
    return { stream, close: () => stream.destroy(), plate: requested ?? 1 };
  }
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    open(
      path,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, archive) =>
        error || !archive
          ? reject(new FileError(400, "The 3MF archive could not be opened."))
          : resolve(archive),
    );
  });
  return new Promise((resolve, reject) => {
    let entries = 0;
    const plates = new Map<number, Entry>();
    const fail = (error: unknown) => {
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", () => {
      const available = [...plates.keys()].sort((a, b) => a - b);
      const plate = requested ?? available[0];
      const entry = plate === undefined ? undefined : plates.get(plate);
      if (!entry || plate === undefined)
        return fail(
          new FileError(
            404,
            available.length
              ? `Plate ${requested} has no sliced G-code. This file contains plate ${available.join(", ")}.`
              : "This 3MF has no sliced G-code. Slice the project before previewing layers.",
          ),
        );
      if (entry.uncompressedSize > MAX_BYTES * 2)
        return fail(new FileError(413, "Sliced G-code exceeds the 1 GiB preview limit."));
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(new FileError(400, "Sliced G-code could not be read."));
        resolve({
          stream,
          plate,
          close: () => {
            stream.destroy();
            zip.close();
          },
        });
      });
    });
    zip.on("entry", (entry: Entry) => {
      if (++entries > 20000)
        return fail(new FileError(413, "3MF archive contains too many entries."));
      const plate = entry.fileName.match(/^Metadata\/plate_(\d+)\.gcode$/i)?.[1];
      if (plate) plates.set(Number(plate), entry);
      zip.readEntry();
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
const CHUNK = 65536;
const MAX_OBJECTS = 1024;
const HULL_ROW = 10;
const TOOLPATH_LIMIT = dequantize(65535);
type ObjectShape = {
  id: number;
  index: number;
  rows: Map<number, [number, number, number, number]>;
  minZ: number;
  maxZ: number;
};
class SegmentSpool {
  readonly positions = new Uint16Array((CHUNK + 1024) * 6);
  readonly objects = new Uint16Array(CHUNK + 1024);
  pending = 0;
  written = 0;
  constructor(
    readonly positionFile: FileHandle,
    readonly objectFile: FileHandle,
  ) {}
  get count() {
    return this.written + this.pending;
  }
  push(from: Point, to: Point, object: number) {
    const base = this.pending * 6;
    for (let axis = 0; axis < 3; axis++) {
      this.positions[base + axis] = quantize(from[axis]!);
      this.positions[base + 3 + axis] = quantize(to[axis]!);
    }
    this.objects[this.pending++] = object;
  }
  async drain(force = false) {
    if (!this.pending || (!force && this.pending < CHUNK)) return;
    await this.positionFile.write(
      new Uint8Array(this.positions.buffer, 0, this.pending * 12),
      0,
      this.pending * 12,
      this.written * 12,
    );
    await this.objectFile.write(
      new Uint8Array(this.objects.buffer, 0, this.pending * 2),
      0,
      this.pending * 2,
      this.written * 2,
    );
    this.written += this.pending;
    this.pending = 0;
  }
  async reset() {
    this.pending = 0;
    this.written = 0;
    await Promise.all([this.positionFile.truncate(0), this.objectFile.truncate(0)]);
  }
}
function trackObject(shape: ObjectShape, point: Point) {
  const row = Math.floor(quantize(point[1]) / HULL_ROW);
  const extent = shape.rows.get(row);
  if (!extent) shape.rows.set(row, [point[0], point[1], point[0], point[1]]);
  else {
    if (point[0] < extent[0]) {
      extent[0] = point[0];
      extent[1] = point[1];
    }
    if (point[0] > extent[2]) {
      extent[2] = point[0];
      extent[3] = point[1];
    }
  }
  shape.minZ = Math.min(shape.minZ, point[2]);
  shape.maxZ = Math.max(shape.maxZ, point[2]);
}
const round = (value: number) => Math.round(value * 100) / 100;
function convexHull(points: [number, number][]) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: [number, number][]) => {
    const result: [number, number][] = [];
    for (const point of list) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop();
      result.push(point);
    }
    result.pop();
    return result;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}
function objectSummary(shape: ObjectShape): ToolpathObject {
  const points: [number, number][] = [];
  for (const [minX, minY, maxX, maxY] of shape.rows.values())
    points.push([round(minX), round(minY)], [round(maxX), round(maxY)]);
  return { id: shape.id, hull: convexHull(points), minZ: shape.minZ, maxZ: shape.maxZ };
}
function decimationStride(layerCounts: number[], total: number) {
  const kept = (stride: number) =>
    layerCounts.reduce((sum, count) => sum + Math.ceil(count / stride), 0);
  let stride = Math.max(1, Math.ceil(total / TOOLPATH_SEGMENT_BUDGET));
  while (kept(stride) > TOOLPATH_SEGMENT_BUDGET) stride++;
  return stride;
}
async function copySegments(
  source: FileHandle,
  width: number,
  layerCounts: number[],
  stride: number,
  target: FileHandle,
  offset: number,
) {
  const total = layerCounts.reduce((sum, count) => sum + count, 0);
  const input = Buffer.allocUnsafe(CHUNK * width);
  const output = Buffer.allocUnsafe(CHUNK * width);
  let layer = 0,
    inLayer = 0,
    read = 0;
  while (read < total) {
    const count = Math.min(CHUNK, total - read);
    const { bytesRead } = await source.read(input, 0, count * width, read * width);
    if (bytesRead !== count * width) throw new FileError(500, "Toolpath preview is incomplete.");
    let kept = 0;
    for (let index = 0; index < count; index++) {
      while (inLayer >= layerCounts[layer]!) {
        layer++;
        inLayer = 0;
      }
      if (inLayer % stride === 0)
        input.copy(output, kept++ * width, index * width, (index + 1) * width);
      inLayer++;
    }
    await target.write(output, 0, kept * width, offset);
    offset += kept * width;
    read += count;
  }
  return offset;
}
export async function parseToolpath(
  path: string,
  requestedPlate: number | undefined,
  directory: string,
  filename: string,
): Promise<Preview> {
  const positionPath = join(directory, "positions.bin"),
    objectPath = join(directory, "objects.bin");
  const source = await gcodeStream(path, requestedPlate);
  const handles: FileHandle[] = [];
  try {
    const positionFile = await openFile(positionPath, "w+", 0o600);
    handles.push(positionFile);
    const objectFile = await openFile(objectPath, "w+", 0o600);
    handles.push(objectFile);
    const spool = new SegmentSpool(positionFile, objectFile);
    const warnings: string[] = [];
    const warn = (message: string) => {
      if (!warnings.includes(message)) warnings.push(message);
    };
    let bounds: { min: Point; max: Point } = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    let layerCounts: number[] = [],
      layerZs: number[] = [],
      layerStart = 0,
      objects = new Map<number, ObjectShape>(),
      label: number | undefined;
    let position: Point = [0, 0, 0],
      extrusion = 0,
      absolute = true,
      absoluteE = true,
      scale = 1;
    let pendingLayer = false,
      markedLayers = false,
      layerZ = 0;
    let plane = 17,
      absoluteArc = false,
      conditionalDepth = 0;
    const flush = () => {
      const count = spool.count - layerStart;
      if (!count) return;
      if (layerCounts.length >= 20000) throw new FileError(413, "Preview exceeds 20,000 layers.");
      layerCounts.push(count);
      layerZs.push(layerZ);
      layerStart = spool.count;
    };
    const currentObject = () => {
      if (label === undefined) return undefined;
      let shape = objects.get(label);
      if (shape) return shape;
      if (objects.size >= MAX_OBJECTS) {
        warn("Only the first 1,024 labelled objects can be selected in the preview.");
        return undefined;
      }
      shape = {
        id: label,
        index: objects.size + 1,
        rows: new Map(),
        minZ: Infinity,
        maxZ: -Infinity,
      };
      objects.set(label, shape);
      return shape;
    };
    const add = (from: Point, to: Point) => {
      if (from.every((value, index) => value === to[index])) return;
      if (spool.count >= 8000000 || spool.count - layerStart >= 150000)
        throw new FileError(413, "Toolpath is too complex for preview.");
      const shape = currentObject();
      spool.push(from, to, shape?.index ?? 0);
      for (const point of [from, to]) {
        for (let axis = 0; axis < 3; axis++) {
          bounds.min[axis] = Math.min(bounds.min[axis]!, point[axis]!);
          bounds.max[axis] = Math.max(bounds.max[axis]!, point[axis]!);
          if (point[axis]! < TOOLPATH_ORIGIN || point[axis]! > TOOLPATH_LIMIT)
            warn("Some paths fall outside the preview volume and are drawn at its edge.");
        }
        if (shape) trackObject(shape, point);
      }
    };
    for await (const raw of lines(source.stream)) {
      if (
        /^\s*;\s*(?:CHANGE_LAYER|LAYER_CHANGE|LAYER:\s*\d+|layer num\/total_layer_count\s*:)/i.test(
          raw,
        )
      ) {
        if (!markedLayers) {
          layerCounts = [];
          layerZs = [];
          layerStart = 0;
          objects = new Map();
          bounds = {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity],
          };
          await spool.reset();
        }
        pendingLayer = true;
        markedLayers = true;
      }
      const marker = raw.match(/^\s*;\s*(start|stop) printing object, unique label id:\s*(\d+)/i);
      if (marker) {
        label = marker[1]!.toLowerCase() === "start" ? Number(marker[2]) : undefined;
        continue;
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
          const layerEmpty = spool.count === layerStart;
          if (pendingLayer || (!markedLayers && !layerEmpty && next[2] > layerZ + 0.001)) flush();
          if (spool.count === layerStart) layerZ = next[2];
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
          await spool.drain();
        }
        position = next;
        extrusion = nextE;
      }
    }
    flush();
    await spool.drain(true);
    if (!markedLayers)
      warn(
        "Layer boundaries are estimated from extrusion height because this file has no layer markers.",
      );
    if (!layerCounts.length)
      throw new FileError(422, "No printable extrusion paths were found in this file.");
    const stride = decimationStride(layerCounts, spool.count);
    if (stride > 1)
      warn("The toolpath is simplified for preview; some segments in each layer are hidden.");
    const layerEnds = new Uint32Array(layerCounts.length);
    let segmentCount = 0;
    for (const [index, count] of layerCounts.entries())
      layerEnds[index] = segmentCount += Math.ceil(count / stride);
    const header: ToolpathHeader = {
      version: TOOLPATH_VERSION,
      filename,
      plate: source.plate,
      layerCount: layerCounts.length,
      segmentCount,
      layerZ: layerZs,
      bounds,
      objects: [...objects.values()].map(objectSummary),
      simplified: stride > 1,
      warnings,
    };
    const payload = join(directory, "toolpath.bin");
    const output = await openFile(payload, "w", 0o600);
    handles.push(output);
    const prefix = encodeToolpathHeader(header);
    await output.write(prefix, 0, prefix.byteLength, 0);
    await output.write(
      new Uint8Array(layerEnds.buffer),
      0,
      layerEnds.byteLength,
      prefix.byteLength,
    );
    const positionsEnd = await copySegments(
      positionFile,
      12,
      layerCounts,
      stride,
      output,
      prefix.byteLength + layerEnds.byteLength,
    );
    await copySegments(objectFile, 2, layerCounts, stride, output, positionsEnd);
    return { directory, payload };
  } finally {
    source.close();
    await Promise.all(handles.map((handle) => handle.close()));
    await Promise.all([rm(positionPath, { force: true }), rm(objectPath, { force: true })]);
  }
}
async function build(profile: Printer, file: string, plate: number | undefined): Promise<Preview> {
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
    const result = await parseToolpath(path, plate, directory, file);
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
  const reportedPlate = input.file
    ? undefined
    : String(print.gcode_file || "").match(/plate_(\d{1,4})\.gcode/i)?.[1];
  const plate = input.plate ?? (reportedPlate ? Number(reportedPlate) : undefined);
  const key = JSON.stringify([profile.id, file, plate ?? null, print.task_id, print.subtask_id]);
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
    return await readFile(data.payload);
  } finally {
    item.users--;
    if (item.invalidated && item.users === 0) removeCached(key, item);
  }
}
