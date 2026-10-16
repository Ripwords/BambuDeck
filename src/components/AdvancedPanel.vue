<script setup lang="ts">
import { computed, reactive, ref } from "vue";
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
type Telemetry = Record<string, unknown>;
function bit(value: unknown, index: number) {
  if (typeof value === "number" && Number.isInteger(value)) return ((value >> index) & 1) === 1;
  if (typeof value === "string" && /^[0-9a-f]{1,32}$/i.test(value))
    return ((BigInt("0x" + value) >> BigInt(index)) & BigInt(1)) === BigInt(1);
  return undefined;
}
function supported(print: Telemetry, homeBit: number, funBit: number) {
  return bit(print.fun, funBit) ?? bit(print.home_flag, homeBit) ?? true;
}
function record(value: unknown): Telemetry | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Telemetry)
    : undefined;
}
function option(name: string, label: string, stateBit: number) {
  return {
    label,
    action: "option",
    values: (enabled: boolean) => ({ option: name, enabled }),
    enabled: (print: Telemetry) => bit(print.home_flag, stateBit),
  };
}
const preferenceTable = [
  { ...option("auto_recovery", "Automatic print recovery", 4), supported: () => true },
  {
    ...option("auto_switch_filament", "Automatic filament switching", 10),
    supported: (print: Telemetry) => {
      const units = record(print.ams)?.ams;
      return !Array.isArray(units) || units.length > 0;
    },
  },
  {
    ...option("filament_tangle_detect", "Filament tangle detection", 20),
    supported: (print: Telemetry) => supported(print, 19, 9),
  },
  {
    ...option("sound_enable", "Printer sounds", 17),
    supported: (print: Telemetry) => supported(print, 18, 8),
  },
  {
    label: "Build plate marker detection",
    action: "marker",
    values: (enabled: boolean) => ({ enabled }),
    enabled: (print: Telemetry) => {
      const value = record(print.xcam)?.buildplate_marker_detector;
      return typeof value === "boolean" ? value : undefined;
    },
    supported: (print: Telemetry) => {
      const xcam = record(print.xcam);
      return !xcam || "buildplate_marker_detector" in xcam;
    },
  },
];
const preferences = computed(() => {
  const print: Telemetry = props.connected ? props.status.print || {} : {};
  return preferenceTable
    .filter((preference) => preference.supported(print))
    .map((preference) => ({ ...preference, state: preference.enabled(print) }));
});
async function setPreference(action: string, values: Record<string, unknown>) {
  await execute(action, values);
  await api(props.base + "/advanced", { action: "refresh" }).catch(() => {});
}
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
          <p>Shows the state your printer reports. Options it doesn't support are hidden.</p>
        </div>
        <fieldset :disabled="!connected || busy" class="preferences">
          <div v-for="preference in preferences" :key="preference.label" class="preference-row">
            <span>{{ preference.label }}</span
            ><button
              :class="{ primary: preference.state === true }"
              :aria-pressed="preference.state === undefined ? undefined : preference.state"
              @click="setPreference(preference.action, preference.values(true))"
            >
              Enable</button
            ><button
              :class="{ primary: preference.state === false }"
              :aria-pressed="preference.state === undefined ? undefined : !preference.state"
              @click="setPreference(preference.action, preference.values(false))"
            >
              Disable
            </button>
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
