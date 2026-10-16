export type Point = [number, number, number];

export const TOOLPATH_VERSION = 1;
export const TOOLPATH_ORIGIN = -100;
export const TOOLPATH_STEP = 0.01;
export const TOOLPATH_SEGMENT_BUDGET = 1_500_000;

export interface ToolpathObject {
  id: number;
  hull: [number, number][];
  minZ: number;
  maxZ: number;
}

export interface ToolpathHeader {
  version: typeof TOOLPATH_VERSION;
  filename: string;
  plate: number;
  layerCount: number;
  segmentCount: number;
  layerZ: number[];
  bounds: { min: Point; max: Point };
  objects: ToolpathObject[];
  simplified: boolean;
  warnings: string[];
}

export interface Toolpath extends ToolpathHeader {
  layerEnds: Uint32Array;
  positions: Uint16Array;
  objectIndices: Uint16Array;
}

export function quantize(millimetres: number) {
  return Math.min(65535, Math.max(0, Math.round((millimetres - TOOLPATH_ORIGIN) / TOOLPATH_STEP)));
}

export function dequantize(value: number) {
  return value * TOOLPATH_STEP + TOOLPATH_ORIGIN;
}

export function toolpathLayout(headerBytes: number, layerCount: number, segmentCount: number) {
  const headerEnd = 4 + headerBytes;
  const layerEndsOffset = headerEnd + ((4 - (headerEnd % 4)) % 4);
  const positionsOffset = layerEndsOffset + layerCount * 4;
  const objectsOffset = positionsOffset + segmentCount * 12;
  return {
    layerEndsOffset,
    positionsOffset,
    objectsOffset,
    totalBytes: objectsOffset + segmentCount * 2,
  };
}

export function encodeToolpathHeader(header: ToolpathHeader) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const layout = toolpathLayout(json.byteLength, header.layerCount, header.segmentCount);
  const prefix = new Uint8Array(layout.layerEndsOffset);
  new DataView(prefix.buffer).setUint32(0, json.byteLength, true);
  prefix.set(json, 4);
  return prefix;
}

export function decodeToolpath(buffer: ArrayBuffer): Toolpath {
  if (buffer.byteLength < 4) throw new Error("Toolpath preview is empty.");
  const headerBytes = new DataView(buffer).getUint32(0, true);
  if (4 + headerBytes > buffer.byteLength) throw new Error("Toolpath preview is truncated.");
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerBytes)),
  ) as ToolpathHeader;
  if (header.version !== TOOLPATH_VERSION) throw new Error("Unsupported toolpath preview version.");
  const layout = toolpathLayout(headerBytes, header.layerCount, header.segmentCount);
  if (layout.totalBytes !== buffer.byteLength) throw new Error("Toolpath preview is corrupted.");
  const layerEnds = new Uint32Array(buffer, layout.layerEndsOffset, header.layerCount);
  if (layerEnds[header.layerCount - 1] !== header.segmentCount)
    throw new Error("Toolpath preview layers are inconsistent.");
  return {
    ...header,
    layerEnds,
    positions: new Uint16Array(buffer, layout.positionsOffset, header.segmentCount * 6),
    objectIndices: new Uint16Array(buffer, layout.objectsOffset, header.segmentCount),
  };
}
