<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { Camera, Download, Maximize, RefreshCw } from "lucide-vue-next";
import AppModal from "./AppModal.vue";
const props = defineProps<{ base: string; connected: boolean }>();
const frame = ref(""),
  message = ref("Waiting for camera"),
  active = ref(true);
const enlarged = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined,
  controller: AbortController | undefined,
  generation = 0,
  failures = 0;
function stop() {
  generation++;
  clearTimeout(timer);
  controller?.abort();
  controller = undefined;
}
async function next(epoch: number) {
  if (
    epoch !== generation ||
    document.hidden ||
    !active.value ||
    !props.connected
  )
    return;
  const requestController = new AbortController();
  controller = requestController;
  const timeout = setTimeout(() => requestController.abort(), 18000);
  let pending = "";
  try {
    const response = await fetch(`${props.base}/snapshot?t=${Date.now()}`, {
      cache: "no-store",
      signal: requestController.signal,
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Camera unavailable. Retrying…");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
      throw new Error("Waiting for a camera frame…");
    pending = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Unable to decode frame"));
      img.src = pending;
    });
    if (epoch !== generation) {
      URL.revokeObjectURL(pending);
      return;
    }
    const previous = frame.value;
    frame.value = pending;
    pending = "";
    if (previous) URL.revokeObjectURL(previous);
    message.value = "Live camera";
    failures = 0;
  } catch (error) {
    if (epoch === generation) {
      failures++;
      message.value =
        error instanceof Error && error.name !== "AbortError"
          ? error.message
          : "Camera timed out. Retrying…";
    }
  } finally {
    clearTimeout(timeout);
    if (pending) URL.revokeObjectURL(pending);
    if (epoch === generation)
      timer = setTimeout(
        () => next(epoch),
        Math.min(1000 * 2 ** failures, 15000),
      );
  }
}
function start() {
  stop();
  if (!document.hidden && active.value && props.connected)
    void next(generation);
}
function download() {
  if (!frame.value) return;
  const link = document.createElement("a");
  link.href = frame.value;
  link.download = `printer-${Date.now()}.jpg`;
  link.click();
}
watch(
  () => props.base,
  () => {
    if (frame.value) URL.revokeObjectURL(frame.value);
    frame.value = "";
    message.value = "Waiting for camera";
    failures = 0;
    start();
  },
);
watch(() => [props.connected, active.value], start, { immediate: true });
document.addEventListener("visibilitychange", start);
onUnmounted(() => {
  stop();
  document.removeEventListener("visibilitychange", start);
  if (frame.value) URL.revokeObjectURL(frame.value);
});
</script>
<template>
  <section class="camera panel">
    <div class="panel-heading">
      <h2>Live view</h2>
      <span class="muted camera-label">Live camera</span
      ><button
        class="icon-button"
        title="Save snapshot"
        aria-label="Save snapshot"
        :disabled="!frame"
        @click="download"
      >
        <Download :size="18" /></button
      ><button
        class="icon-button"
        title="Enlarge camera"
        aria-label="Enlarge camera"
        @click="enlarged = true"
      >
        <Maximize :size="18" />
      </button>
    </div>
    <div class="camera-stage">
      <img v-if="frame" :src="frame" alt="Live printer camera" />
      <div v-else class="camera-empty">
        <Camera :size="40" :stroke-width="1.3" />
        <p>{{ connected ? message : "Connect a printer to see its camera" }}</p>
      </div>
      <div class="camera-overlay">
        <span class="live-dot" :class="{ offline: !connected || !active }" />{{
          active ? message : "Camera paused"
        }}<button @click="active = !active">
          {{ active ? "Pause view" : "Resume view" }}
        </button>
      </div>
    </div>
    <div v-if="failures > 0" class="camera-retry">
      <span>{{ message }}</span
      ><button class="text-button" @click="start">
        <RefreshCw :size="14" />Retry
      </button>
    </div>
  </section>
  <AppModal
    v-if="enlarged"
    title="Camera"
    class="camera-modal"
    @close="enlarged = false"
  >
    <div class="camera-expanded-stage">
      <img v-if="frame" :src="frame" alt="Enlarged live printer camera" />
      <p v-else>{{ connected ? message : "Connect a printer to see its camera" }}</p>
    </div>
    <div class="camera-expanded-controls">
      <span>{{ active ? message : "Camera paused" }}</span>
      <button @click="active = !active">
        {{ active ? "Pause view" : "Resume view" }}
      </button>
      <button :disabled="!frame" @click="download">
        <Download :size="16" />Save
      </button>
    </div>
  </AppModal>
</template>
