const maximumTriangles = 250_000;
export function validateStl(buffer: ArrayBuffer) {
  if (buffer.byteLength < 84) throw new Error("This STL file contains no viewable triangles.");
  const bytes = new Uint8Array(buffer);
  const faces = new DataView(buffer).getUint32(80, true);
  const expectedLength = 84 + faces * 50;
  const solid = [115, 111, 108, 105, 100];
  const ascii = [0, 1, 2, 3, 4].some((offset) =>
    solid.every((byte, index) => bytes[offset + index] === byte),
  );
  if (expectedLength === buffer.byteLength || !ascii) {
    if (expectedLength !== buffer.byteLength)
      throw new Error("This binary STL file is incomplete or malformed.");
    if (!faces || faces > maximumTriangles)
      throw new Error("STL previews support 1 to 250,000 triangles.");
    return;
  }
  const text = new TextDecoder().decode(buffer);
  let triangles = 0;
  let vertices = 0;
  for (const match of text.matchAll(/\b(facet|vertex)\b/g)) {
    if (match[1] === "facet") triangles++;
    else vertices++;
    if (triangles > maximumTriangles || vertices > maximumTriangles * 3)
      throw new Error("STL previews support up to 250,000 triangles.");
  }
  if (!triangles || vertices !== triangles * 3)
    throw new Error("This ASCII STL file contains invalid triangles.");
}
