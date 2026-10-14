<script setup lang="ts">
import { reactive, onActivated } from "vue";
import { LogOut, Printer, Pencil } from "lucide-vue-next";
import { api } from "../api";
import AdvancedPanel from "../components/AdvancedPanel.vue";
import { useDashboard } from "../composables/dashboard";
import type { Profile } from "../types";
const emit = defineEmits<{ editPrinter: [profile: Profile] }>();
const {
  base,
  selected,
  profiles,
  connected,
  status,
  busy,
  error,
  run,
  showNotice,
  connect,
  logout,
} = useDashboard();
const settings = reactive({
  mqttBroker: "",
  mqttUser: "",
  mqttPassword: "",
  mqttPrefix: "homeassistant",
  mqttPasswordSet: false,
});
onActivated(() => run(async () => Object.assign(settings, await api("/api/settings"))));
</script>
<template>
  <section class="panel">
    <div class="panel-heading">
      <h2>Your printers</h2>
      <span class="muted">{{ profiles.length }} saved</span>
    </div>
    <div v-if="!profiles.length" class="empty-inline">
      No printers yet. Add your first printer above.
    </div>
    <div v-for="item in profiles" class="saved-printer">
      <Printer :size="25" />
      <div>
        <strong>{{ item.name }}</strong
        ><small>{{ item.hostMasked }} · {{ item.serialMasked }}</small>
      </div>
      <button @click="emit('editPrinter', item)"><Pencil :size="15" />Edit</button>
    </div>
  </section>
  <section class="panel settings-panel">
    <div>
      <h2>Home Assistant</h2>
      <p>Publish printer status and controls through your MQTT broker.</p>
    </div>
    <form
      class="settings-form"
      @submit.prevent="
        run(async () => {
          await api('/api/settings', settings, 'PUT');
          settings.mqttPassword = '';
          showNotice('MQTT settings saved. Reconnecting printer…');
          await connect();
        })
      "
    >
      <label
        >MQTT broker<input
          v-model="settings.mqttBroker"
          placeholder="tcp://192.168.1.10:1883" /></label
      ><label
        >Discovery prefix<input v-model="settings.mqttPrefix" placeholder="homeassistant" /></label
      ><label>Username<input v-model="settings.mqttUser" autocomplete="off" /></label
      ><label
        >Password<input
          v-model="settings.mqttPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="
            settings.mqttPasswordSet ? 'Saved · leave blank to retain' : 'Broker password'
          "
      /></label>
      <p class="help">Leave the broker blank to disable the integration.</p>
      <button class="primary" :disabled="busy">Save integration</button>
    </form>
  </section>
  <AdvancedPanel
    v-if="selected"
    :base="base"
    :connected="connected"
    mode="hardware"
    :status="status"
    @error="error = $event"
    @notice="showNotice"
  />
  <section class="session-panel">
    <div><h2>Your session</h2></div>
    <button @click="logout"><LogOut :size="16" />Sign out</button>
  </section>
</template>
