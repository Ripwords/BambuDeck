<script setup lang="ts">
import { ref, shallowRef, computed, watch, onUnmounted, onActivated, onDeactivated } from "vue";
import { Expand, RefreshCw, X } from "lucide-vue-next";
import PreviewCanvas from "./PreviewCanvas.vue";
import ObjectSkipList from "./ObjectSkipList.vue";
import { decodeToolpath } from "../../shared/toolpath";
import type { ObjectState, PreviewGeometry } from "../preview/types";
const props = withDefaults(
  defineProps<{
    base: string;
    connected: boolean;
    filename?: string;
    fileSize?: number;
    currentLayer?: number;
    jobKey?: string;
    skipped?: readonly number[];
  }>(),
  { currentLayer: 0, jobKey: "", skipped: () => [] },
);
const geometry = shallowRef<PreviewGeometry>();
const loading = ref(false);
const error = ref("");
const expanded = ref(false);
const dialog = ref<HTMLDialogElement>();
const live = computed(() => !props.filename);
const follow = ref(live.value);
const chosenLayer = ref(1);
const selected = ref<ReadonlySet<number>>(new Set());
const hovered = ref<number>();
const active = ref(true);
const toolpath = computed(() => (geometry.value?.kind === "toolpath" ? geometry.value : undefined));
const identity = computed(() => `${props.base}\n${props.filename || ""}\n${props.jobKey}`);
const layer = computed(() => {
  const count = toolpath.value?.layerCount || 0;
  return Math.min(follow.value ? props.currentLayer : chosenLayer.value, count);
});
const layerZ = computed(() => toolpath.value?.layerZ[layer.value - 1]);
const skippedSet = computed(() => new Set(props.skipped));
const objectState = computed<ObjectState>(() => ({
  skipped: skippedSet.value,
  selected: selected.value,
  hovered: hovered.value,
}));
const downloadLimit = 64 * 1024 * 1024;
let request: AbortController | undefined;
let sequence = 0;
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
async function downloadToolpath(signal: AbortSignal) {
  const params = new URLSearchParams();
  if (props.filename) {
    params.set("file", props.filename);
    params.set("plate", "1");
  }
  const response = await fetch(`${props.base}/preview?${params}`, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(String(details.error || "Unable to load print preview."));
  }
  return decodeToolpath(await response.arrayBuffer());
}
async function load() {
  request?.abort();
  const ticket = ++sequence;
  if (!props.connected || !active.value || geometry.value) {
    loading.value = false;
    return;
  }
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const next: PreviewGeometry = /\.stl$/i.test(props.filename || "")
      ? { kind: "stl", buffer: await downloadModel(controller.signal) }
      : { kind: "toolpath", ...(await downloadToolpath(controller.signal)) };
    if (ticket !== sequence) return;
    if (next.kind === "toolpath") chosenLayer.value = next.layerCount;
    geometry.value = next;
  } catch (cause) {
    if (ticket === sequence && !controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : "Unable to load print preview.";
  } finally {
    if (ticket === sequence) loading.value = false;
  }
}
function stop() {
  sequence++;
  request?.abort();
  loading.value = false;
}
function resetSelection() {
  selected.value = new Set();
  hovered.value = undefined;
}
function chooseLayer(event: Event) {
  follow.value = false;
  chosenLayer.value = Number((event.target as HTMLInputElement).value);
}
function toggle(id: number | undefined) {
  if (id === undefined || skippedSet.value.has(id)) return;
  const next = new Set(selected.value);
  if (!next.delete(id)) next.add(id);
  selected.value = next;
}
function close() {
  expanded.value = false;
  hovered.value = undefined;
  if (live.value) follow.value = true;
}
watch(
  identity,
  () => {
    stop();
    geometry.value = undefined;
    error.value = "";
    follow.value = live.value;
    resetSelection();
    void load();
  },
  { immediate: true },
);
watch(
  () => props.connected,
  (connected) => {
    resetSelection();
    if (connected) void load();
    else stop();
  },
);
watch(skippedSet, (skipped) => {
  if ([...selected.value].some((id) => skipped.has(id)))
    selected.value = new Set([...selected.value].filter((id) => !skipped.has(id)));
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
  close();
  stop();
});
onUnmounted(stop);
</script>
<template>
  <section class="print-preview" aria-label="Print model preview">
    <PreviewCanvas
      v-if="geometry && !expanded"
      :key="identity"
      :geometry="geometry"
      :layer="layer"
      :object-state="objectState"
    />
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
      <span>{{
        !toolpath ? "3D model" : live ? "Planned paths" : `${toolpath.layerCount} layers`
      }}</span>
      <span v-if="toolpath?.simplified" class="muted">Simplified</span>
      <button class="text-button" @click="expanded = true"><Expand :size="15" />Explore</button>
    </div>
    <Teleport to="body">
      <dialog
        v-if="expanded"
        ref="dialog"
        class="preview-dialog"
        :class="{ 'with-objects': live && toolpath }"
        @cancel.prevent="close"
        @click="$event.target === dialog && close()"
      >
        <div class="modal-heading">
          <h2>{{ toolpath ? "Layer preview" : "Model preview" }}</h2>
          <button class="icon-button" aria-label="Close preview" @click="close">
            <X :size="20" />
          </button>
        </div>
        <div class="preview-dialog-body">
          <div class="preview-dialog-main">
            <PreviewCanvas
              v-if="geometry"
              :key="identity"
              :geometry="geometry"
              :layer="layer"
              :object-state="objectState"
              :pickable="live && !!toolpath?.objects.length"
              @pick="toggle"
              @hover="hovered = $event"
            />
            <div v-if="toolpath" class="preview-layer-controls">
              <div class="preview-layer-row">
                <label for="preview-layer"
                  >Layer {{ layer }} / {{ toolpath.layerCount
                  }}<span v-if="layerZ !== undefined" class="muted">
                    {{ layerZ.toFixed(2) }} mm</span
                  ></label
                ><button
                  v-if="live"
                  class="live-button"
                  :class="{ primary: follow }"
                  :aria-pressed="follow"
                  @click="follow = true"
                >
                  Live
                </button>
              </div>
              <input
                id="preview-layer"
                type="range"
                min="1"
                :max="toolpath.layerCount"
                :value="Math.max(layer, 1)"
                @input="chooseLayer"
              />
              <p class="help">Planned paths, not the live nozzle position.</p>
              <p v-for="warning in toolpath.warnings" :key="warning" class="help">{{ warning }}</p>
            </div>
            <p v-else class="help">
              Drag to orbit, pinch to zoom. Layer preview requires a sliced file.
            </p>
          </div>
          <ObjectSkipList
            v-if="live && toolpath"
            :toolpath="toolpath"
            :skipped="skippedSet"
            :selected="selected"
            :hovered="hovered"
            @toggle="toggle"
            @hover="hovered = $event"
            @skipped="resetSelection"
          />
        </div>
      </dialog>
    </Teleport>
  </section>
</template>
