<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { RotateCcw } from "lucide-vue-next";
import type { ObjectState, PreviewGeometry } from "../preview/types";
import type { createPreviewScene } from "../preview/scene";
const props = withDefaults(
  defineProps<{
    geometry: PreviewGeometry;
    layer?: number;
    objectState?: ObjectState;
    pickable?: boolean;
  }>(),
  { layer: Number.POSITIVE_INFINITY, pickable: false },
);
const emit = defineEmits<{ pick: [id: number | undefined]; hover: [id: number | undefined] }>();
const container = ref<HTMLElement>();
const error = ref("");
const hovering = ref(false);
let scene: ReturnType<typeof createPreviewScene> | undefined;
let disposed = false;
let press: { id: number; x: number; y: number } | undefined;
let hovered: number | undefined;
async function update() {
  try {
    await scene?.update(props.geometry);
    error.value = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to render this model.";
  }
}
function syncState() {
  scene?.setLayer(props.layer);
  if (props.objectState) scene?.setObjectState(props.objectState);
}
onMounted(async () => {
  try {
    const { createPreviewScene } = await import("../preview/scene");
    if (disposed || !container.value) return;
    scene = createPreviewScene(container.value);
    syncState();
    await update();
  } catch {
    error.value = "3D preview requires WebGL. Try another browser or enable hardware acceleration.";
  }
});
watch(() => props.geometry, update);
watch(
  () => props.layer,
  (layer) => scene?.setLayer(layer),
);
watch(
  () => props.objectState,
  (state) => {
    if (state) scene?.setObjectState(state);
  },
);
function pointerDown(event: PointerEvent) {
  press = event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined;
}
function pointerUp(event: PointerEvent) {
  const start = press;
  press = undefined;
  if (!props.pickable || !scene || !start || start.id !== event.pointerId) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6) return;
  emit("pick", scene.pick(event.clientX, event.clientY));
}
function pointerMove(event: PointerEvent) {
  if (!props.pickable || !scene || event.pointerType !== "mouse" || event.buttons) return;
  const id = scene.pick(event.clientX, event.clientY);
  hovering.value = id !== undefined;
  if (id === hovered) return;
  hovered = id;
  emit("hover", id);
}
function pointerLeave() {
  press = undefined;
  hovering.value = false;
  if (hovered === undefined) return;
  hovered = undefined;
  emit("hover", undefined);
}
onUnmounted(() => {
  disposed = true;
  scene?.dispose();
});
</script>
<template>
  <div class="preview-canvas-shell">
    <div
      ref="container"
      class="preview-canvas"
      :class="{ picking: pickable && hovering }"
      @pointerdown="pointerDown"
      @pointerup="pointerUp"
      @pointercancel="press = undefined"
      @pointermove="pointerMove"
      @pointerleave="pointerLeave"
    />
    <p v-if="error" class="preview-render-error" role="status">{{ error }}</p>
    <button
      v-else
      class="icon-button preview-reset"
      aria-label="Reset model view"
      @click="scene?.reset()"
    >
      <RotateCcw :size="16" />
    </button>
  </div>
</template>
