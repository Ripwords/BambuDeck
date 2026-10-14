<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { RotateCcw } from "lucide-vue-next";
import type { PreviewGeometry } from "../preview/types";
import type { createPreviewScene } from "../preview/scene";
const props = defineProps<{ geometry: PreviewGeometry }>();
const container = ref<HTMLElement>();
const error = ref("");
let scene: ReturnType<typeof createPreviewScene> | undefined;
let disposed = false;
async function update() {
  try {
    await scene?.update(props.geometry);
    error.value = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to render this model.";
  }
}
onMounted(async () => {
  try {
    const { createPreviewScene } = await import("../preview/scene");
    if (disposed || !container.value) return;
    scene = createPreviewScene(container.value);
    await update();
  } catch {
    error.value = "3D preview requires WebGL. Try another browser or enable hardware acceleration.";
  }
});
watch(() => props.geometry, update);
onUnmounted(() => {
  disposed = true;
  scene?.dispose();
});
</script>
<template>
  <div class="preview-canvas-shell">
    <div ref="container" class="preview-canvas" />
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
