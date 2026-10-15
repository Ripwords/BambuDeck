<script setup lang="ts">
import { ref, reactive, watch, onBeforeUnmount } from "vue";
import { api } from "../api";
import AppModal from "../components/AppModal.vue";
import { useDashboard } from "../composables/dashboard";
import type { Profile } from "../types";
const { selected, busy, error, run, loadProfiles, connect } = useDashboard();
const modal = ref(""),
  editing = ref(""),
  printerForm = reactive({ name: "", host: "", serial: "", code: "" });
type DiscoveredPrinter = { host: string; serial: string; model: string };
const discoveryResults = ref<DiscoveredPrinter[]>([]);
const discoveryError = ref("");
const scanning = ref(false);
const scanned = ref(false);
const discoveredSelection = ref(false);
let discoveryController: AbortController | undefined;
function resetDiscovery() {
  discoveryController?.abort();
  discoveryController = undefined;
  discoveryResults.value = [];
  discoveryError.value = "";
  scanning.value = false;
  scanned.value = false;
  discoveredSelection.value = false;
}
onBeforeUnmount(resetDiscovery);
watch(modal, (value) => {
  if (value !== "printer") {
    resetDiscovery();
    printerForm.host = "";
    printerForm.serial = "";
    printerForm.code = "";
  }
});
function editPrinter(item?: Profile) {
  resetDiscovery();
  editing.value = item?.id || "";
  Object.assign(printerForm, {
    name: item?.name || "",
    host: "",
    serial: "",
    code: "",
  });
  modal.value = "printer";
}
async function findPrinters() {
  discoveryController?.abort();
  const controller = new AbortController();
  discoveryController = controller;
  scanning.value = true;
  scanned.value = false;
  discoveryError.value = "";
  discoveryResults.value = [];
  try {
    const result = await api<{ printers: DiscoveredPrinter[] }>(
      "/api/discovery/scan",
      {},
      "POST",
      controller.signal,
    );
    if (controller.signal.aborted) return;
    discoveryResults.value = result.printers;
    scanned.value = true;
  } catch (cause) {
    if (controller.signal.aborted) return;
    discoveryError.value = cause instanceof Error ? cause.message : "Discovery failed.";
  } finally {
    if (discoveryController === controller) {
      scanning.value = false;
      discoveryController = undefined;
    }
  }
}
function choosePrinter(printer: DiscoveredPrinter) {
  printerForm.host = printer.host;
  printerForm.serial = printer.serial;
  printerForm.code = "";
  discoveredSelection.value = true;
}
async function savePrinter() {
  await run(async () => {
    const result = await api<Profile>(
      `/api/printers${editing.value ? "/" + editing.value : ""}`,
      printerForm,
      editing.value ? "PUT" : "POST",
    );
    modal.value = "";
    await loadProfiles();
    if (selected.value === result.id) await connect();
    else selected.value = result.id;
  });
}
async function removePrinter() {
  await run(async () => {
    await api(`/api/printers/${editing.value}`, undefined, "DELETE");
    modal.value = "";
    await loadProfiles();
  });
}
defineExpose({ open: editPrinter });
</script>
<template>
  <AppModal
    v-if="modal"
    :title="
      modal === 'remove-printer' ? 'Remove printer?' : editing ? 'Edit printer' : 'Add your printer'
    "
    @close="modal = ''"
  >
    <form v-if="modal === 'printer'" @submit.prevent="savePrinter">
      <p class="modal-description">
        Enable LAN mode on your printer. Find these details in its network and device settings.
      </p>
      <div class="printer-discovery">
        <button type="button" :disabled="scanning || busy" @click="findPrinters">
          {{ scanning ? "Finding printers…" : "Find printer" }}
        </button>
        <p v-if="scanning" class="modal-description" role="status">
          Listening for printers on your local network…
        </p>
        <p v-else-if="scanned && !discoveryResults.length" class="modal-description" role="status">
          No printers found. Check that your printer is awake and on the same network. Docker may
          need host networking. You can still enter its details below.
        </p>
        <p v-if="discoveryError" class="error" role="alert">{{ discoveryError }}</p>
        <ul
          v-if="discoveryResults.length"
          class="discovery-results"
          aria-label="Discovered printers"
        >
          <li v-for="printer in discoveryResults" :key="printer.serial">
            <button type="button" :disabled="busy" @click="choosePrinter(printer)">
              <strong>{{ printer.serial }}</strong>
              <span
                >{{ printer.host
                }}<template v-if="printer.model"> · {{ printer.model }}</template></span
              >
              <span>Use this printer</span>
            </button>
          </li>
        </ul>
        <p v-if="discoveredSelection" class="modal-description" role="status">
          Address and serial filled in. Enter this printer's LAN access code, then save.
        </p>
      </div>
      <label
        >Printer name<input v-model="printerForm.name" required placeholder="Printer name" /></label
      ><label
        >IP address or hostname<input
          v-model="printerForm.host"
          :required="!editing"
          :placeholder="editing ? 'Leave blank to retain' : '192.168.1.100'"
          autocomplete="off" /></label
      ><label
        >Serial number<input
          v-model="printerForm.serial"
          :required="!editing"
          :placeholder="editing ? 'Leave blank to retain' : 'Printer serial number'"
          autocomplete="off" /></label
      ><label
        >LAN access code<input
          v-model="printerForm.code"
          type="password"
          :required="!editing || discoveredSelection"
          :placeholder="
            editing && !discoveredSelection ? 'Leave blank to retain' : '8-character access code'
          "
          autocomplete="new-password"
      /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="modal-actions">
        <button
          v-if="editing"
          type="button"
          class="danger-subtle"
          @click="modal = 'remove-printer'"
        >
          Remove</button
        ><button type="button" @click="modal = ''">Cancel</button
        ><button class="primary" :disabled="busy">
          {{ busy ? "Saving…" : "Save printer" }}
        </button>
      </div>
    </form>
    <div v-else>
      <p>Remove this saved printer and its credentials?</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button @click="modal = ''">Cancel</button
        ><button class="danger" :disabled="busy" @click="removePrinter">Delete</button>
      </div>
    </div></AppModal
  >
</template>
<style scoped>
.printer-discovery {
  margin-bottom: 1rem;
}
.discovery-results {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  list-style: none;
  max-height: 15rem;
  overflow-y: auto;
}
.discovery-results button {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
