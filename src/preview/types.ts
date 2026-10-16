import type { Toolpath } from "../../shared/toolpath";
export type ToolpathPreview = { kind: "toolpath" } & Toolpath;
export interface MeshPreview {
  kind: "stl";
  buffer: ArrayBuffer;
}
export type PreviewGeometry = ToolpathPreview | MeshPreview;
export interface ObjectState {
  skipped: ReadonlySet<number>;
  selected: ReadonlySet<number>;
  hovered?: number;
}
