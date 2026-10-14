<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { api } from "../api";
import AppModal from "../components/AppModal.vue";
import { useDashboard } from "../composables/dashboard";
import type { Profile } from "../types";
const { selected, busy, error, run, loadProfiles, connect } = useDashboard();
const modal = ref(""),
  editing = ref(""),
  printerForm = reactive({ name: "", host: "", serial: "", code: "" });
watch(modal, (value) => {
  if (value !== "printer") {
    printerForm.host = "";
    printerForm.serial = "";
    printerForm.code = "";
  }
});
function editPrinter(item?: Profile) {
  editing.value = item?.id || "";
  Object.assign(printerForm, {
    name: item?.name || "",
    host: "",
    serial: "",
    code: "",
  });
  modal.value = "printer";
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
          :required="!editing"
          :placeholder="editing ? 'Leave blank to retain' : '8-character access code'"
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
