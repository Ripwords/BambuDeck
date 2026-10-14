export interface ToolpathPreview {
  kind: "toolpath";
  filename: string;
  plate: number;
  layerCount: number;
  layer: number;
  z: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  segments: number[];
  model: number[];
  warnings: string[];
}
export interface MeshPreview {
  kind: "stl";
  buffer: ArrayBuffer;
}
export type PreviewGeometry = ToolpathPreview | MeshPreview;
