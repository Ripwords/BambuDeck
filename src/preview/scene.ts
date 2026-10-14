import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewGeometry } from "./types";
import { validateStl } from "./validateStl";

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
  let object: THREE.Group | undefined;
  let grid: THREE.GridHelper | undefined;
  let disposed = false;
  let revision = 0;
  let fitted = false;
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
  function reset() {
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
    controls.update();
    render();
  }
  async function update(data: PreviewGeometry) {
    const ticket = ++revision;
    const next = new THREE.Group();
    if (data.kind === "toolpath") {
      for (const [points, color, opacity] of [
        [data.model, 0x82958b, 0.2],
        [data.segments, 0x28ae72, 1],
      ] as const) {
        if (!points.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        const material = new THREE.LineBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity === 1,
        });
        const lines = new THREE.LineSegments(geometry, material);
        lines.renderOrder = opacity === 1 ? 1 : 0;
        next.add(lines);
      }
    } else {
      validateStl(data.buffer);
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      const geometry = new STLLoader().parse(data.buffer);
      geometry.computeVertexNormals();
      next.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: 0x42a879, roughness: 0.65, metalness: 0.05 }),
        ),
      );
    }
    if (disposed || revision !== ticket) {
      disposeObject(next);
      return;
    }
    const bounds = new THREE.Box3().setFromObject(next);
    if (bounds.isEmpty() || !Number.isFinite(bounds.max.length())) {
      disposeObject(next);
      throw new Error("This file contains no viewable geometry.");
    }
    if (object) {
      scene.remove(object);
      disposeObject(object);
    }
    object = next;
    scene.add(object);
    if (!fitted) {
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
    render();
  }
  function dispose() {
    disposed = true;
    revision++;
    resize.disconnect();
    controls.dispose();
    if (object) disposeObject(object);
    if (grid) {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  return { update, reset, dispose };
}
