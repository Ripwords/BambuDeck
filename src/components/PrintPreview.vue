<script setup lang="ts">
import { ref, shallowRef, computed, watch, onUnmounted, onActivated, onDeactivated } from "vue";
import { Expand, RefreshCw, X } from "lucide-vue-next";
import PreviewCanvas from "./PreviewCanvas.vue";
import type { PreviewGeometry, ToolpathPreview } from "../preview/types";
const props = withDefaults(
  defineProps<{
    base: string;
    connected: boolean;
    filename?: string;
    fileSize?: number;
    currentLayer?: number;
    jobKey?: string;
  }>(),
  { currentLayer: 0, jobKey: "" },
);
const geometry = shallowRef<PreviewGeometry>();
const loading = ref(false);
const error = ref("");
const expanded = ref(false);
const dialog = ref<HTMLDialogElement>();
const follow = ref(!props.filename);
const layer = ref(1);
const active = ref(true);
const toolpath = computed(() => (geometry.value?.kind === "toolpath" ? geometry.value : undefined));
const identity = computed(() => `${props.base}\n${props.filename || ""}\n${props.jobKey}`);
const downloadLimit = 64 * 1024 * 1024;
let request: AbortController | undefined;
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let cachedModel: number[] | undefined;
async function downloadModel(signal: AbortSignal): Promise<ArrayBuffer> {
  if ((props.fileSize || 0) > downloadLimit)
    throw new Error("Model preview is limited to 64 MB files.");
  const response = await fetch(
    `${props.base}/download?path=${encodeURIComponent(props.filename || "")}`,
    { signal, credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok) throw new Error("Unable to download this model from the printer.");
  if (Number(response.headers.get("content-length")) > downloadLimit) {
    await response.body?.cancel();
    throw new Error("Model preview is limited to 64 MB files.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Model download is unavailable.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > downloadLimit) {
        await reader.cancel();
        throw new Error("Model preview is limited to 64 MB files.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined.buffer;
}
async function load() {
  clearTimeout(timer);
  request?.abort();
  const ticket = ++sequence;
  if (!props.connected || !active.value) {
    loading.value = false;
    return;
  }
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    if (/\.stl$/i.test(props.filename || "")) {
      const buffer = await downloadModel(controller.signal);
      if (ticket === sequence) geometry.value = { kind: "stl", buffer };
      return;
    }
    const params = new URLSearchParams();
    const filename = props.filename || toolpath.value?.filename;
    if (filename) {
      params.set("file", filename);
      params.set("plate", String(toolpath.value?.plate || 1));
    }
    const requestedLayer = follow.value ? props.currentLayer : layer.value;
    if (requestedLayer > 0) params.set("layer", String(requestedLayer));
    if (cachedModel) params.set("model", "0");
    const response = await fetch(`${props.base}/preview?${params}`, {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const message = String(details.error || "Unable to load print preview.");
      throw new Error(message);
    }
    const result = (await response.json()) as ToolpathPreview;
    if (ticket !== sequence) return;
    if (cachedModel) result.model = cachedModel;
    else cachedModel = result.model;
    geometry.value = result;
    layer.value = result.layer;
  } catch (cause) {
    if (ticket === sequence && !controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : "Unable to load print preview.";
  } finally {
    if (ticket === sequence) loading.value = false;
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 250);
}
function chooseLayer(event: Event) {
  follow.value = false;
  layer.value = Number((event.target as HTMLInputElement).value);
  schedule();
}
function stop() {
  clearTimeout(timer);
  sequence++;
  request?.abort();
  loading.value = false;
}
watch(
  identity,
  () => {
    stop();
    geometry.value = undefined;
    cachedModel = undefined;
    error.value = "";
    follow.value = !props.filename;
    layer.value = Math.max(1, props.currentLayer);
    void load();
  },
  { immediate: true },
);
watch(
  () => props.connected,
  (connected) => {
    if (connected) void load();
    else stop();
  },
);
watch(
  () => props.currentLayer,
  () => {
    if (follow.value && (!geometry.value || toolpath.value)) schedule();
  },
);
watch(follow, (enabled) => {
  if (enabled) schedule();
});
watch(dialog, (element) => {
  if (element) element.showModal();
});
onActivated(() => {
  if (!active.value) {
    active.value = true;
    void load();
  }
});
onDeactivated(() => {
  active.value = false;
  expanded.value = false;
  stop();
});
onUnmounted(stop);
</script>
<template>
  <section class="print-preview" aria-label="Print model preview">
    <PreviewCanvas v-if="geometry && !expanded" :key="identity" :geometry="geometry" />
    <div v-else-if="!geometry" class="preview-placeholder">
      <RefreshCw v-if="loading" :size="22" class="spinning" />
      <span>{{
        loading
          ? "Loading 3D preview…"
          : !connected
            ? "Connect to preview"
            : error || "Preview unavailable"
      }}</span>
      <button v-if="error && connected" class="text-button" @click="load">Retry</button>
    </div>
    <div v-if="geometry" class="preview-caption">
      <span>{{ toolpath ? `Layer ${toolpath.layer} / ${toolpath.layerCount}` : "3D model" }}</span>
      <span v-if="loading" class="muted">Updating…</span>
      <button class="text-button" @click="expanded = true"><Expand :size="15" />Explore</button>
    </div>
    <p v-if="error && geometry" class="preview-warning" role="status">
      {{ error }} <button class="text-button" @click="load">Retry</button>
    </p>
    <Teleport to="body">
      <dialog
        v-if="expanded"
        ref="dialog"
        class="preview-dialog"
        @cancel.prevent="expanded = false"
        @click="$event.target === dialog && (expanded = false)"
      >
        <div class="modal-heading">
          <h2>{{ toolpath ? "Layer preview" : "Model preview" }}</h2>
          <button class="icon-button" aria-label="Close preview" @click="expanded = false">
            <X :size="20" />
          </button>
        </div>
        <PreviewCanvas v-if="geometry" :key="identity" :geometry="geometry" />
        <div v-if="toolpath" class="preview-layer-controls">
          <label for="preview-layer"
            >Layer {{ layer }} / {{ toolpath.layerCount
            }}<span>{{ toolpath.z.toFixed(2) }} mm</span></label
          >
          <input
            id="preview-layer"
            type="range"
            min="1"
            :max="toolpath.layerCount"
            :value="layer"
            @input="chooseLayer"
          />
          <label v-if="!filename" class="checkbox-label"
            ><input v-model="follow" type="checkbox" />Follow current layer</label
          >
          <span v-if="loading" class="muted">Loading layer…</span>
          <p class="help">Planned extrusion paths. Drag to orbit, pinch to zoom.</p>
          <p v-for="warning in toolpath.warnings" :key="warning" class="help">{{ warning }}</p>
        </div>
        <p v-else class="help">
          Drag to orbit, pinch to zoom. Layer preview requires a sliced file.
        </p>
        <p v-if="error" class="error" role="status">
          {{ error }} <button @click="load">Retry</button>
        </p>
      </dialog>
    </Teleport>
  </section>
</template>
