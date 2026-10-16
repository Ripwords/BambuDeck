import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TOOLPATH_ORIGIN, TOOLPATH_STEP } from "../../shared/toolpath";
import type { ObjectState, PreviewGeometry, ToolpathPreview } from "./types";
import { validateStl } from "./validateStl";

const stateWidth = 1024;
const vertexShader = `
uniform float uStep;
uniform float uOrigin;
uniform int uCurrentStart;
uniform bool uGhost;
uniform sampler2D uStates;
uniform vec3 uPrinted;
uniform vec3 uCurrent;
uniform vec3 uMuted;
uniform vec3 uSelected;
attribute float objectIndex;
varying vec4 vColor;
void main() {
  int index = int(objectIndex + 0.5);
  vec4 state = texelFetch(uStates, ivec2(index % ${stateWidth}, index / ${stateWidth}), 0);
  vec3 color = uGhost ? uMuted : (gl_VertexID >= uCurrentStart ? uCurrent : uPrinted);
  float alpha = uGhost ? 0.18 : 1.0;
  if (state.r > 0.5) {
    color = uMuted;
    alpha = uGhost ? 0.06 : 0.3;
  } else if (state.g > 0.5) {
    color = uSelected;
    alpha = uGhost ? 0.6 : 1.0;
  } else if (state.b > 0.5) {
    color = mix(color, uSelected, 0.55);
    alpha = max(alpha, 0.5);
  }
  vColor = vec4(color, alpha);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uStep + uOrigin, 1.0);
}`;
const fragmentShader = `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
  #include <colorspace_fragment>
}`;

let colorContext: CanvasRenderingContext2D | null | undefined;
function themeColor(name: string, fallback: string) {
  colorContext ??= Object.assign(document.createElement("canvas"), {
    width: 1,
    height: 1,
  }).getContext("2d", { willReadFrequently: true });
  const color = new THREE.Color(fallback);
  if (!colorContext) return color;
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = fallback;
  colorContext.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  colorContext.fillRect(0, 0, 1, 1);
  const [red, green, blue] = colorContext.getImageData(0, 0, 1, 1).data;
  return color.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
}
function palette() {
  return {
    printed: themeColor("--color-focus", "#2f9a6a"),
    current: themeColor("--color-ink", "#1d2a22"),
    muted: themeColor("--color-muted", "#6f7d72"),
    selected: themeColor("--color-danger", "#b4462f"),
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function buildToolpath(data: ToolpathPreview) {
  if (!data.segmentCount) throw new Error("This file contains no viewable geometry.");
  const position = new THREE.BufferAttribute(data.positions, 3);
  const vertexObjects = new Uint16Array(data.segmentCount * 2);
  for (let index = 0; index < data.segmentCount; index++) {
    vertexObjects[index * 2] = vertexObjects[index * 2 + 1] = data.objectIndices[index];
  }
  const objectIndex = new THREE.BufferAttribute(vertexObjects, 1);
  const rows = Math.ceil((data.objects.length + 1) / stateWidth);
  const states = new THREE.DataTexture(new Uint8Array(stateWidth * rows * 4), stateWidth, rows);
  states.needsUpdate = true;
  const colors = palette();
  const uniforms = {
    uStep: { value: TOOLPATH_STEP },
    uOrigin: { value: TOOLPATH_ORIGIN },
    uCurrentStart: { value: 0 },
    uStates: { value: states },
    uPrinted: { value: colors.printed },
    uCurrent: { value: colors.current },
    uMuted: { value: colors.muted },
    uSelected: { value: colors.selected },
  };
  const segments = (ghost: boolean) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", position);
    geometry.setAttribute("objectIndex", objectIndex);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uGhost: { value: ghost } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: !ghost,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = ghost ? 1 : 0;
    return lines;
  };
  const printed = segments(false);
  const ghost = segments(true);
  const group = new THREE.Group();
  group.add(printed, ghost);
  const pickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const targets = data.objects.flatMap((object) => {
    if (object.hull.length < 3 || !(object.maxZ >= object.minZ)) return [];
    const shape = new THREE.Shape(object.hull.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(object.maxZ - object.minZ, 0.2),
      bevelEnabled: false,
    });
    const mesh = new THREE.Mesh(geometry, pickMaterial);
    mesh.position.z = object.minZ;
    mesh.updateMatrixWorld();
    mesh.userData.id = object.id;
    return [mesh];
  });
  const min = new THREE.Vector3(...data.bounds.min);
  const max = new THREE.Vector3(...data.bounds.max);
  return {
    group,
    bounds: new THREE.Box3(min, max),
    targets,
    setLayer(value: number) {
      const layer = Math.min(Math.max(Math.round(value), 0), data.layerCount);
      const end = layer ? data.layerEnds[layer - 1] : 0;
      const start = layer > 1 ? data.layerEnds[layer - 2] : 0;
      uniforms.uCurrentStart.value = start * 2;
      printed.geometry.setDrawRange(0, end * 2);
      ghost.geometry.setDrawRange(end * 2, (data.segmentCount - end) * 2);
    },
    setObjectState(state: ObjectState) {
      const pixels = states.image.data as Uint8Array;
      pixels.fill(0);
      data.objects.forEach((object, index) => {
        const offset = (index + 1) * 4;
        pixels[offset] = state.skipped.has(object.id) ? 255 : 0;
        pixels[offset + 1] = state.selected.has(object.id) ? 255 : 0;
        pixels[offset + 2] = state.hovered === object.id ? 255 : 0;
      });
      states.needsUpdate = true;
    },
    applyTheme() {
      const next = palette();
      uniforms.uPrinted.value.copy(next.printed);
      uniforms.uCurrent.value.copy(next.current);
      uniforms.uMuted.value.copy(next.muted);
      uniforms.uSelected.value.copy(next.selected);
    },
    dispose() {
      disposeObject(group);
      states.dispose();
      for (const target of targets) target.geometry.dispose();
      pickMaterial.dispose();
    },
  };
}
type ToolpathView = ReturnType<typeof buildToolpath>;

export function createPreviewScene(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D print preview. Drag to orbit and pinch to zoom.",
  );
  renderer.domElement.setAttribute("role", "img");
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(180, -220, 180);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = true;
  controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x647469, 2.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.position.set(100, -100, 200);
  scene.add(keyLight);
  const raycaster = new THREE.Raycaster();
  let object: THREE.Group | undefined;
  let toolpath: ToolpathView | undefined;
  let grid: THREE.GridHelper | undefined;
  let disposed = false;
  let revision = 0;
  let fitted = false;
  let layer = Number.POSITIVE_INFINITY;
  let objectState: ObjectState = { skipped: new Set(), selected: new Set() };
  let homePosition = camera.position.clone();
  let homeTarget = controls.target.clone();
  const render = () => {
    if (!disposed) renderer.render(scene, camera);
  };
  controls.addEventListener("change", render);
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  });
  resize.observe(container);
  const themeObserver = new MutationObserver(() => {
    toolpath?.applyTheme();
    render();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  function reset() {
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
    controls.update();
    render();
  }
  function fit(bounds: THREE.Box3) {
    const center = bounds.getCenter(new THREE.Vector3());
    const dimensions = bounds.getSize(new THREE.Vector3());
    const span = Math.max(dimensions.x, dimensions.y, dimensions.z, 10);
    homeTarget = center.clone();
    homePosition = center
      .clone()
      .add(new THREE.Vector3(1, -1.4, 1).normalize().multiplyScalar(span * 2.8));
    camera.near = Math.max(0.01, span / 1000);
    camera.far = span * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = span * 0.1;
    controls.maxDistance = span * 20;
    grid = new THREE.GridHelper(Math.max(span * 1.5, 20), 12, 0x708177, 0x708177);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(center.x, center.y, bounds.min.z - 0.1);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.18;
    scene.add(grid);
    fitted = true;
    reset();
  }
  async function update(data: PreviewGeometry) {
    const ticket = ++revision;
    let next: THREE.Group;
    let nextToolpath: ToolpathView | undefined;
    let bounds: THREE.Box3;
    if (data.kind === "toolpath") {
      nextToolpath = buildToolpath(data);
      next = nextToolpath.group;
      bounds = nextToolpath.bounds;
    } else {
      validateStl(data.buffer);
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      const geometry = new STLLoader().parse(data.buffer);
      geometry.computeVertexNormals();
      next = new THREE.Group();
      next.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: 0x42a879, roughness: 0.65, metalness: 0.05 }),
        ),
      );
      bounds = new THREE.Box3().setFromObject(next);
    }
    const release = () => (nextToolpath ? nextToolpath.dispose() : disposeObject(next));
    if (disposed || revision !== ticket) {
      release();
      return;
    }
    if (bounds.isEmpty() || !Number.isFinite(bounds.max.length())) {
      release();
      throw new Error("This file contains no viewable geometry.");
    }
    clear();
    object = next;
    toolpath = nextToolpath;
    toolpath?.setLayer(layer);
    toolpath?.setObjectState(objectState);
    scene.add(object);
    if (!fitted) fit(bounds);
    render();
  }
  function clear() {
    if (object) scene.remove(object);
    if (toolpath) toolpath.dispose();
    else if (object) disposeObject(object);
    object = undefined;
    toolpath = undefined;
  }
  function setLayer(value: number) {
    layer = value;
    if (!toolpath) return;
    toolpath.setLayer(value);
    render();
  }
  function setObjectState(state: ObjectState) {
    objectState = state;
    if (!toolpath) return;
    toolpath.setObjectState(state);
    render();
  }
  function pick(clientX: number, clientY: number): number | undefined {
    if (!toolpath?.targets.length) return undefined;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const [hit] = raycaster.intersectObjects(toolpath.targets, false);
    return hit ? Number(hit.object.userData.id) : undefined;
  }
  function dispose() {
    disposed = true;
    revision++;
    resize.disconnect();
    themeObserver.disconnect();
    controls.dispose();
    clear();
    if (grid) {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  return { update, reset, dispose, setLayer, setObjectState, pick };
}
