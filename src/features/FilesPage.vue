<script setup lang="ts">
import { ref, reactive, computed, watch, onActivated } from "vue";
import {
  Box,
  FolderOpen,
  RefreshCw,
  Printer,
  Play,
  Trash2,
  Pencil,
  Download,
  Upload,
  FolderPlus,
  ArrowLeft,
} from "lucide-vue-next";
import { api, form } from "../api";
import AppModal from "../components/AppModal.vue";
import PrintPreview from "../components/PrintPreview.vue";
import { useDashboard } from "../composables/dashboard";
const { base, selected, tab, connected, status, busy, error, run, showNotice } = useDashboard();
const modal = ref("");
const previewFile = ref<PrinterFile>();
type PrinterFile = {
  Name: string;
  Size: number;
  Type: "dir" | "file";
  Modified?: string;
};
type FileSort = "Name" | "Size" | "Modified";
const fileSearch = ref("");
const fileSort = ref<FileSort>("Name");
const fileSortDescending = ref(false);
const fileColumns = [
  { key: "Name", label: "Name" },
  { key: "Size", label: "Size" },
  { key: "Modified", label: "Modified" },
] as const;
function modifiedTime(file: PrinterFile) {
  const value = Date.parse(file.Modified || "");
  return Number.isFinite(value) ? value : 0;
}
function modifiedLabel(file: PrinterFile) {
  const value = modifiedTime(file);
  return value ? new Date(value).toLocaleDateString() : "—";
}
function sortFiles(column: FileSort) {
  fileSortDescending.value = fileSort.value === column ? !fileSortDescending.value : false;
  fileSort.value = column;
}
const visibleFiles = computed(() => {
  const query = fileSearch.value.trim().toLocaleLowerCase();
  return files.value
    .filter((file) => file.Name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (a.Type !== b.Type) return a.Type === "dir" ? -1 : 1;
      const names = a.Name.localeCompare(b.Name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      const comparison =
        fileSort.value === "Size"
          ? a.Size - b.Size
          : fileSort.value === "Modified"
            ? modifiedTime(a) - modifiedTime(b)
            : names;
      return (comparison || names) * (fileSortDescending.value ? -1 : 1);
    });
});
const files = ref<PrinterFile[]>([]),
  directory = ref("/"),
  filesLoading = ref(false),
  fileName = ref(""),
  fileTarget = ref(""),
  printTarget = ref(""),
  metadata = ref<any>(null);
const flags = reactive({
    timelapse: false,
    bed_leveling: true,
    flow_calibration: false,
    vibration_calibration: true,
    layer_inspection: false,
    use_ams: true,
  }),
  bedType = ref("auto"),
  printPlate = ref<number>();
type PlateSummary = { id: number; sliced?: boolean; prediction?: string; weight?: string };
const printPlates = computed<PlateSummary[]>(() => metadata.value?.metadata?.plates || []);
const slicedPlates = computed(() => printPlates.value.filter((plate) => plate.sliced));
const noSlicedPlates = computed(() => !!metadata.value?.metadata && !slicedPlates.value.length);
async function loadFiles() {
  filesLoading.value = true;
  try {
    files.value =
      (await api<PrinterFile[]>(
        base.value + "/files?path=" + encodeURIComponent(directory.value),
      )) || [];
  } finally {
    filesLoading.value = false;
  }
}
function filePath(name: string) {
  return directory.value + name;
}
async function openFolder(path: string) {
  directory.value = path;
  fileSearch.value = "";
  files.value = [];
  await run(loadFiles);
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await run(async () => {
    const data = new FormData();
    data.set("file", file);
    data.set("path", directory.value);
    await api(base.value + "/upload", data);
    await loadFiles();
    showNotice("File uploaded");
  });
  (event.target as HTMLInputElement).value = "";
}
async function fileAction() {
  await run(async () => {
    if (modal.value === "mkdir")
      await api(base.value + "/mkdir", form({ path: filePath(fileName.value) }));
    else if (modal.value === "rename")
      await api(
        base.value + "/rename",
        form({ oldPath: fileTarget.value, newPath: filePath(fileName.value) }),
      );
    else await api(base.value + "/delete", form({ file: fileTarget.value }));
    modal.value = "";
    await loadFiles();
  });
}
async function preparePrint(path: string) {
  printTarget.value = path;
  metadata.value = null;
  printPlate.value = undefined;
  modal.value = "print";
  if (/\.3mf$/i.test(path))
    await run(async () => {
      metadata.value = await api(base.value + "/metadata?file=" + encodeURIComponent(path));
      printPlate.value = slicedPlates.value[0]?.id;
    });
}
async function startPrint() {
  await run(async () => {
    const data = new FormData();
    for (const [key, val] of Object.entries({
      existing_path: printTarget.value,
      bed_type: bedType.value,
      ...(printPlate.value ? { plate: printPlate.value } : {}),
      ...flags,
    }))
      data.set(key, String(val));
    await api(base.value + "/print", data);
    modal.value = "";
    tab.value = "Overview";
    showNotice("Print request sent");
  });
}
const flagLabels: Record<string, string> = {
  timelapse: "Record timelapse",
  bed_leveling: "Bed leveling",
  flow_calibration: "Flow calibration",
  vibration_calibration: "Vibration calibration",
  layer_inspection: "First layer inspection",
  use_ams: "Use AMS",
};
function size(bytes: number) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
watch(selected, () => {
  directory.value = "/";
  fileSearch.value = "";
  files.value = [];
  modal.value = "";
  previewFile.value = undefined;
});
watch(connected, (value) => {
  if (value && tab.value === "Files") void run(loadFiles);
});
onActivated(() => {
  if (connected.value) void run(loadFiles);
});
</script>
<template>
  <section class="panel files-panel">
    <div class="files-toolbar">
      <div><h2>Printer storage</h2></div>
      <div class="button-group">
        <button
          :disabled="!connected || busy"
          @click="
            fileName = '';
            modal = 'mkdir';
          "
        >
          <FolderPlus :size="17" />New folder</button
        ><label class="button primary" :class="{ disabled: !connected || busy }"
          ><Upload :size="17" />Upload<input
            class="sr-only"
            type="file"
            :disabled="!connected || busy"
            @change="upload"
        /></label>
      </div>
    </div>
    <div class="file-path">
      <button
        class="icon-button"
        aria-label="Parent folder"
        :disabled="directory === '/' || !connected"
        @click="openFolder(directory.replace(/[^/]+\/$/, ''))"
      >
        <ArrowLeft :size="17" /></button
      ><code>{{ directory }}</code
      ><button
        class="icon-button"
        aria-label="Refresh files"
        :disabled="!connected || filesLoading"
        @click="run(loadFiles)"
      >
        <RefreshCw :size="17" /></button
      ><a
        v-if="connected"
        class="text-button"
        :href="base + '/archive?path=' + encodeURIComponent(directory)"
        download
        >Download folder</a
      >
    </div>
    <div class="file-search">
      <input
        v-model="fileSearch"
        type="search"
        aria-label="Search files in this folder"
        placeholder="Search files…"
      />
    </div>
    <p v-if="filesLoading" class="empty-inline">Loading printer storage…</p>
    <p v-else-if="!files.length" class="empty-inline">
      {{
        connected
          ? "This folder is empty. Upload a file to get started."
          : "Connect your printer to browse its storage."
      }}
    </p>
    <p v-else-if="!visibleFiles.length" class="empty-inline">No matching files.</p>
    <div
      v-if="!filesLoading && files.length"
      role="table"
      aria-label="Printer files"
      class="file-table"
    >
      <div role="row" class="file-columns">
        <div
          v-for="column in fileColumns"
          :key="column.key"
          role="columnheader"
          :aria-sort="
            fileSort === column.key ? (fileSortDescending ? 'descending' : 'ascending') : 'none'
          "
        >
          <button @click="sortFiles(column.key)">
            {{ column.label
            }}<span aria-hidden="true">{{
              fileSort === column.key ? (fileSortDescending ? "↓" : "↑") : "↕"
            }}</span>
          </button>
        </div>
        <div role="columnheader" class="sr-only">Actions</div>
      </div>
      <div v-for="file in visibleFiles" :key="file.Name" class="file-row" role="row">
        <div class="file-info" role="cell">
          <FolderOpen v-if="file.Type === 'dir'" :size="20" /><Box v-else :size="20" />
          <button
            v-if="file.Type === 'dir'"
            class="file-name"
            @click="openFolder(filePath(file.Name) + '/')"
          >
            {{ file.Name }}</button
          ><strong v-else>{{ file.Name }}</strong>
        </div>
        <div class="file-size" role="cell">
          {{ file.Type === "dir" ? "Folder" : size(file.Size || 0) }}
        </div>
        <div class="file-modified" role="cell" :title="file.Modified || undefined">
          {{ modifiedLabel(file) }}
        </div>
        <div class="file-actions" role="cell">
          <button
            v-if="file.Type !== 'dir' && /\.(stl|3mf|gcode)$/i.test(file.Name)"
            :disabled="!connected || busy"
            @click="previewFile = file"
          >
            Preview
          </button>
          <button
            v-if="/\.(3mf|gcode)$/i.test(file.Name)"
            :disabled="!connected || busy"
            @click="preparePrint(filePath(file.Name))"
          >
            <Play :size="15" /><span>Print</span></button
          ><a
            v-if="file.Type !== 'dir'"
            class="icon-button"
            :href="base + '/download?path=' + encodeURIComponent(filePath(file.Name))"
            :aria-label="'Download ' + file.Name"
            download
            ><Download :size="17" /></a
          ><button
            class="icon-button"
            :disabled="!connected || busy"
            :aria-label="'Rename ' + file.Name"
            @click="
              fileTarget = filePath(file.Name);
              fileName = file.Name;
              modal = 'rename';
            "
          >
            <Pencil :size="16" /></button
          ><button
            class="icon-button"
            :disabled="!connected || busy"
            :aria-label="'Delete ' + file.Name"
            @click="
              fileTarget = filePath(file.Name);
              modal = 'delete';
            "
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>
    <div v-if="status.upload_status?.uploading" class="upload-progress">
      <span
        >Uploading {{ status.upload_status.filename }} ·
        {{ Math.round(status.upload_status.percent) }}%</span
      ><progress max="100" :value="status.upload_status.percent" />
    </div>
  </section>
  <AppModal
    v-if="modal"
    :title="
      modal === 'print'
        ? 'Ready to print?'
        : modal === 'delete'
          ? 'Delete from printer?'
          : modal === 'mkdir'
            ? 'New folder'
            : 'Rename file'
    "
    @close="modal = ''"
  >
    <form v-if="modal === 'print'" @submit.prevent="startPrint">
      <p class="print-filename">{{ printTarget.split("/").pop() }}</p>
      <p class="help">Check that the build plate is clear before starting.</p>
      <section v-if="metadata?.metadata" class="print-metadata">
        <p v-if="noSlicedPlates" class="error">
          This 3MF has no sliced plates. Slice it in Bambu Studio and upload it again.
        </p>
        <component
          :is="slicedPlates.length > 1 && plate.sliced ? 'label' : 'div'"
          v-for="plate in printPlates"
          :key="plate.id"
          class="metadata-plate"
          :class="{ selectable: slicedPlates.length > 1 && plate.sliced }"
        >
          <input
            v-if="slicedPlates.length > 1 && plate.sliced"
            v-model="printPlate"
            type="radio"
            name="print-plate"
            :value="plate.id"
          />
          <img
            :src="
              base +
              '/thumbnail?key=' +
              encodeURIComponent((metadata.filename || printTarget) + '/' + plate.id)
            "
            alt="Build plate preview"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div>
            <strong>Plate {{ plate.id }}</strong>
            <p v-if="!plate.sliced && slicedPlates.length">Not sliced</p>
            <p v-if="plate.prediction">Estimated time: {{ plate.prediction }} seconds</p>
            <p v-if="plate.weight">Material: {{ plate.weight }} g</p>
          </div>
        </component>
        <div v-for="material in metadata.metadata.filaments" class="metadata-filament">
          {{ material.type || material.Type || "Filament" }} ·
          {{ material.color || material.Color || "Color not specified" }}
        </div>
        <details>
          <summary>All file details</summary>
          <pre>{{ JSON.stringify(metadata.metadata, null, 2) }}</pre>
        </details>
      </section>
      <label
        >Build plate<select v-model="bedType">
          <option value="auto">Automatic</option>
          <option value="textured_plate">Textured PEI</option>
          <option value="high_temp_plate">Smooth PEI / high temperature</option>
          <option value="cool_plate">Cool plate</option>
          <option value="engineering_plate">Engineering plate</option>
          <option value="supertack_plate">SuperTack plate</option>
        </select></label
      ><label v-for="(_, key) in flags" class="checkbox-label"
        ><input v-model="flags[key]" type="checkbox" />{{ flagLabels[key] }}</label
      >
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button type="button" @click="modal = ''">Cancel</button
        ><button class="primary" :disabled="busy || !connected || noSlicedPlates">
          <Play :size="16" />Start print
        </button>
      </div>
    </form>
    <form v-else-if="['mkdir', 'rename'].includes(modal)" @submit.prevent="fileAction">
      <label>Name<input v-model="fileName" required pattern="[^/\\]+" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button type="button" @click="modal = ''">Cancel</button
        ><button class="primary" :disabled="busy || !connected">Save</button>
      </div>
    </form>
    <div v-else>
      <p>Permanently delete {{ fileTarget }}?</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button @click="modal = ''">Cancel</button
        ><button class="danger" :disabled="busy || !connected" @click="fileAction">Delete</button>
      </div>
    </div></AppModal
  >
  <AppModal v-if="previewFile" :title="previewFile.Name" @close="previewFile = undefined"
    ><PrintPreview
      :base="base"
      :connected="connected"
      :filename="filePath(previewFile.Name)"
      :file-size="previewFile.Size"
  /></AppModal>
</template>
