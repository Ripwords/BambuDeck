<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { api } from "../api";
import AppModal from "./AppModal.vue";
import { useDashboard } from "../composables/dashboard";
import type { ToolpathPreview } from "../preview/types";
const props = defineProps<{
  toolpath: ToolpathPreview;
  skipped: ReadonlySet<number>;
  selected: ReadonlySet<number>;
  hovered?: number;
}>();
const emit = defineEmits<{
  toggle: [id: number];
  hover: [id: number | undefined];
  skipped: [];
}>();
const { base, connected, status, p, busy, error, run, showNotice } = useDashboard();
const confirming = ref(false);
const names = computed(() => {
  const plates: { id?: unknown; index?: unknown; objects?: unknown }[] =
    status.metadata?.plates || [];
  const plate = plates.find((item) => Number(item.id ?? item.index) === props.toolpath.plate);
  const objects = Array.isArray(plate?.objects) ? plate.objects : [];
  return new Map<number, string>(
    objects
      .filter((item) => item && item.identify_id !== undefined && item.name)
      .map((item) => [Number(item.identify_id), String(item.name)]),
  );
});
const rows = computed(() =>
  props.toolpath.objects.map((object) => ({
    id: object.id,
    name: names.value.get(object.id) || `Object ${object.id}`,
    skipped: props.skipped.has(object.id),
    selected: props.selected.has(object.id),
  })),
);
const pending = computed(() => rows.value.filter((row) => row.selected && !row.skipped));
const printing = computed(() => ["RUNNING", "PAUSE"].includes(p.value.gcode_state));
const canSkip = computed(
  () => connected.value && printing.value && !busy.value && pending.value.length > 0,
);
const plural = (count: number) => `${count} object${count === 1 ? "" : "s"}`;
async function confirmSkip() {
  const objects = [...new Set([...props.skipped, ...pending.value.map((row) => row.id)])];
  const endpoint = base.value;
  await run(async () => {
    await api(endpoint + "/control", { cmd: "skip_objects", objects });
    confirming.value = false;
    emit("skipped");
    showNotice("Command sent to printer");
  });
}
watch([base, connected], () => {
  confirming.value = false;
});
</script>
<template>
  <section class="object-skip" aria-label="Objects on this plate">
    <div class="object-skip-heading">
      <h3>Objects</h3>
      <button
        v-if="rows.length"
        class="danger-subtle"
        :disabled="!canSkip"
        @click="confirming = true"
      >
        {{ pending.length ? `Skip ${pending.length}` : "Skip" }}
      </button>
    </div>
    <p v-if="!rows.length" class="help">
      This file has no object labels. Turn on “Exclude objects” or object labelling in your slicer,
      then slice again.
    </p>
    <template v-else>
      <p class="help">
        {{
          printing
            ? "Tap objects in the view or list to select them."
            : "Skipping is available while printing."
        }}
      </p>
      <ul class="object-skip-list">
        <li
          v-for="row in rows"
          :key="row.id"
          :class="{ skipped: row.skipped, hovered: hovered === row.id }"
          @mouseenter="emit('hover', row.id)"
          @mouseleave="emit('hover', undefined)"
        >
          <label class="checkbox-label"
            ><input
              type="checkbox"
              :checked="row.selected && !row.skipped"
              :disabled="row.skipped"
              @change="emit('toggle', row.id)"
            /><span class="object-name">{{ row.name }}</span></label
          ><small v-if="row.skipped">Skipped</small>
        </li>
      </ul>
    </template>
    <AppModal
      v-if="confirming"
      :title="`Skip ${plural(pending.length)}?`"
      @close="confirming = false"
    >
      <p>They stop printing and cannot be restored.</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button @click="confirming = false">Cancel</button
        ><button class="danger" :disabled="!canSkip" @click="confirmSkip">Skip objects</button>
      </div>
    </AppModal>
  </section>
</template>
