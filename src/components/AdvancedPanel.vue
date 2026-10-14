<script setup lang="ts">
import { reactive, ref } from "vue";
import { api } from "../api";
const props = defineProps<{
  base: string;
  connected: boolean;
  mode: "hardware" | "filament";
  status: Record<string, any>;
}>();
const emit = defineEmits<{
  error: [message: string];
  notice: [message: string];
}>();
const busy = ref(false),
  gcode = ref(""),
  objects = ref(""),
  profiles = ref<any[]>([]),
  query = ref("");
const nozzle = reactive({ diameter: "0.4", nozzle_type: "hardened_steel" }),
  filament = reactive({
    ams_id: 0,
    tray_id: 0,
    filament_id: "",
    setting_id: "",
    color: "FFFFFFFF",
    filament_type: "PLA",
    min_temp: 190,
    max_temp: 230,
  }),
  ams = reactive({
    ams_id: 0,
    startup_read: true,
    tray_read: true,
    calibrate_remain: true,
  }),
  factor = reactive({ tray_id: 0, k_value: 0.02, n_coef: 1 });
async function execute(action: string, values: Record<string, unknown> = {}) {
  busy.value = true;
  try {
    await api(props.base + "/advanced", { action, ...values });
    emit("notice", "Command sent to printer");
  } catch (e) {
    emit("error", e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}
async function search() {
  busy.value = true;
  try {
    profiles.value = await api(props.base + "/profiles?q=" + encodeURIComponent(query.value));
  } catch (e) {
    emit("error", e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}
function selectProfile(item: any) {
  Object.assign(filament, {
    filament_id: item.ID || item.Id || item.id || "",
    setting_id: item.SettingID || item.setting_id || "",
    filament_type: item.Type || item.type || "PLA",
    min_temp: Number(item.TempMin) || 190,
    max_temp: Number(item.TempMax) || 230,
  });
}
</script>
<template>
  <div class="advanced-stack" :class="{ disconnected: !connected }">
    <template v-if="mode === 'hardware'"
      ><section class="panel settings-panel">
        <div>
          <h2>Printer preferences</h2>
          <p>
            Commands apply to the selected printer. Availability depends on its model and firmware.
          </p>
        </div>
        <fieldset :disabled="!connected || busy" class="preferences">
          <div
            v-for="[option, label] in [
              ['auto_recovery', 'Automatic print recovery'],
              ['auto_switch_filament', 'Automatic filament switching'],
              ['filament_tangle_detect', 'Filament tangle detection'],
              ['sound_enable', 'Printer sounds'],
            ]"
            class="preference-row"
          >
            <span>{{ label }}</span
            ><button @click="execute('option', { option, enabled: true })">Enable</button
            ><button @click="execute('option', { option, enabled: false })">Disable</button>
          </div>
          <div class="preference-row">
            <span>Build plate marker detection</span
            ><button @click="execute('marker', { enabled: true })">Enable</button
            ><button @click="execute('marker', { enabled: false })">Disable</button>
          </div>
        </fieldset>
      </section>
      <section class="panel settings-panel">
        <div>
          <h2>Nozzle configuration</h2>
          <p>Match these values to the nozzle installed in your printer.</p>
        </div>
        <form @submit.prevent="execute('nozzle', nozzle)">
          <fieldset :disabled="!connected || busy" class="settings-form">
            <label
              >Diameter<select v-model="nozzle.diameter">
                <option>0.2</option>
                <option>0.4</option>
                <option>0.6</option>
                <option>0.8</option>
              </select></label
            ><label
              >Material<select v-model="nozzle.nozzle_type">
                <option value="hardened_steel">Hardened steel</option>
                <option value="stainless_steel">Stainless steel</option>
              </select></label
            ><button>Update nozzle</button>
          </fieldset>
        </form>
      </section>
      <details class="panel advanced-details">
        <summary>Advanced controls</summary>
        <form
          @submit.prevent="
            execute('skip_objects', {
              objects: objects
                .split(',')
                .map((v) => Number(v.trim()))
                .filter(Number.isFinite),
            })
          "
        >
          <fieldset :disabled="!connected || busy">
            <h3>Skip print objects</h3>
            <label
              >Object IDs, separated by commas<input
                v-model="objects"
                required
                pattern="\d+(\s*,\s*\d+)*"
                placeholder="1, 3" /></label
            ><button>Skip objects</button>
          </fieldset>
        </form>
        <form @submit.prevent="execute('gcode', { gcode })">
          <fieldset :disabled="!connected || busy">
            <h3>G-code console</h3>
            <p class="help">
              Commands execute immediately. Check movement and heating instructions before sending.
            </p>
            <label
              >G-code<textarea
                v-model="gcode"
                rows="5"
                required
                spellcheck="false"
                placeholder="M105"
              /></label
            ><button>Send G-code</button>
          </fieldset>
        </form>
      </details>
      <details class="panel advanced-details">
        <summary>Device details & firmware</summary>
        <div class="button-group">
          <button :disabled="!connected || busy" @click="execute('refresh')">Refresh status</button
          ><button :disabled="!connected || busy" @click="execute('version')">
            Request firmware info
          </button>
        </div>
        <pre>{{ JSON.stringify(status, null, 2) }}</pre>
      </details></template
    >
    <template v-else
      ><details class="panel advanced-details">
        <summary>Configure filament & flow</summary>
        <form class="profile-search" @submit.prevent="search">
          <label>Search filament profiles<input v-model="query" placeholder="PLA, PETG…" /></label
          ><button :disabled="!connected || busy">Search</button>
        </form>
        <div v-if="profiles.length" class="profile-results">
          <button v-for="(item, index) in profiles" :key="index" @click="selectProfile(item)">
            {{ item.Name || item.name || item.ID || item.id || "Profile " + (index + 1) }}
          </button>
        </div>
        <form @submit.prevent="execute('filament', filament)">
          <fieldset :disabled="!connected || busy" class="settings-form">
            <label
              >AMS ID<input
                v-model.number="filament.ams_id"
                type="number"
                min="0"
                max="255"
                required /></label
            ><label
              >Tray ID<input
                v-model.number="filament.tray_id"
                type="number"
                min="0"
                max="254"
                required /></label
            ><label
              >Filament profile ID<input
                v-model="filament.filament_id"
                required
                placeholder="GFA00" /></label
            ><label>Setting ID<input v-model="filament.setting_id" required /></label
            ><label>Material<input v-model="filament.filament_type" required /></label
            ><label
              >Color (RGBA hex)<input
                v-model="filament.color"
                pattern="[0-9a-fA-F]{8}"
                required
                maxlength="8" /></label
            ><label
              >Minimum nozzle °C<input
                v-model.number="filament.min_temp"
                type="number"
                min="0"
                max="350"
                required /></label
            ><label
              >Maximum nozzle °C<input
                v-model.number="filament.max_temp"
                type="number"
                :min="filament.min_temp"
                max="350"
                required /></label
            ><button>Save filament</button>
          </fieldset>
        </form>
        <form @submit.prevent="execute('k_factor', factor)">
          <h3>Flow calibration</h3>
          <fieldset :disabled="!connected || busy" class="settings-form">
            <label
              >Global tray ID<input
                v-model.number="factor.tray_id"
                type="number"
                min="0"
                max="254"
                required /></label
            ><label
              >K factor<input
                v-model.number="factor.k_value"
                type="number"
                min="0"
                max="1"
                step="0.001"
                required /></label
            ><label
              >N coefficient<input
                v-model.number="factor.n_coef"
                type="number"
                min="0.001"
                max="10"
                step="0.001"
                required /></label
            ><button>Set calibration</button>
          </fieldset>
        </form>
      </details>
      <details class="panel advanced-details">
        <summary>AMS preferences & recovery</summary>
        <form @submit.prevent="execute('ams_settings', ams)">
          <fieldset :disabled="!connected || busy">
            <label
              >AMS ID<input
                v-model.number="ams.ams_id"
                type="number"
                min="0"
                max="3"
                required /></label
            ><label class="checkbox-label"
              ><input v-model="ams.startup_read" type="checkbox" />Read filament on startup</label
            ><label class="checkbox-label"
              ><input v-model="ams.tray_read" type="checkbox" />Read filament on insertion</label
            ><label class="checkbox-label"
              ><input v-model="ams.calibrate_remain" type="checkbox" />Estimate remaining
              filament</label
            ><button>Save AMS settings</button>
            <div class="button-group">
              <button
                v-for="command in ['resume', 'pause', 'reset']"
                type="button"
                class="capitalize"
                @click="execute('ams_control', { command })"
              >
                {{ command }} AMS
              </button>
            </div>
          </fieldset>
        </form>
      </details></template
    >
  </div>
</template>
