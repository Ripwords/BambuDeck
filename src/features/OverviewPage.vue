<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { Pause, Play, Square, Lightbulb, Thermometer, Fan, AlertCircle } from "lucide-vue-next";
import { api, form } from "../api";
import AppModal from "../components/AppModal.vue";
import { useDashboard } from "../composables/dashboard";
import CameraView from "../components/CameraView.vue";
import PrintPreview from "../components/PrintPreview.vue";
const { base, connected, connecting, status, p, caps, busy, error, run, showNotice, control } =
  useDashboard();
const modal = ref("");
const nozzleIndex = ref(0);
const tempTargets = computed(() =>
  caps.value.has_chamber_heater ? ["nozzle", "bed", "chamber"] : ["nozzle", "bed"],
);
const fanTargets = computed(() => [
  "part",
  ...(caps.value.has_aux_fan ? ["aux"] : []),
  ...(caps.value.has_chamber_fan ? ["chamber"] : []),
]);
const temps = reactive<Record<string, number>>({
    nozzle: 0,
    bed: 0,
    chamber: 0,
  }),
  fanValues = reactive<Record<string, number>>({ part: 0, aux: 0, chamber: 0 });
const fanFields: Record<string, string> = {
  part: "cooling_fan_speed",
  aux: "big_fan1_speed",
  chamber: "big_fan2_speed",
};
const fanEdited = reactive<Record<string, boolean>>({});
const chamberLight = computed(() => {
  if (!connected.value || !Array.isArray(p.value.lights_report)) return null;
  const mode = p.value.lights_report.find(
    (light: { node: string; mode: string }) => light.node === "chamber_light",
  )?.mode;
  return mode === "on" || mode === "off" ? mode : null;
});
watch(
  () => Object.keys(fanFields).map((fan) => fanPercent(fan)),
  (speeds) => {
    Object.keys(fanFields).forEach((fan, index) => {
      const speed = speeds[index];
      if (speed !== null && !fanEdited[fan]) fanValues[fan] = speed;
    });
  },
  { immediate: true },
);
const skippedObjects = computed<number[]>(() =>
  Array.isArray(p.value.s_obj) ? p.value.s_obj.map(Number).filter(Number.isInteger) : [],
);
const printing = computed(() => ["RUNNING", "PAUSE"].includes(p.value.gcode_state));
const remainingMinutes = computed(() => {
  const minutes = Number(p.value.mc_remaining_time);
  return printing.value && p.value.mc_remaining_time !== "" && Number.isFinite(minutes)
    ? Math.max(0, Math.round(minutes))
    : undefined;
});
const remaining = computed(() => {
  const minutes = remainingMinutes.value;
  if (minutes === undefined) return "";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min left` : `${minutes} min left`;
});
const finish = computed(() => {
  const minutes = remainingMinutes.value;
  if (minutes === undefined || p.value.gcode_state !== "RUNNING") return "";
  const end = new Date(Date.now() + minutes * 60000);
  const sameDay = end.toDateString() === new Date().toDateString();
  return `Ends ${end.toLocaleString([], {
    ...(sameDay ? {} : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  })}`;
});
function value(input: unknown, suffix = "") {
  return input === undefined || input === null ? "—" : `${input}${suffix}`;
}
function temperature(input: unknown) {
  if (input === undefined || input === null || input === "") return "—";
  const number = Number(input);
  return Number.isFinite(number) ? `${Math.ceil(number)}°` : "—";
}
function fanPercent(fan: string): number | null {
  if (!connected.value) return null;
  const raw = p.value[fanFields[fan]];
  if (raw === undefined || raw === null || raw === "") return null;
  const speed = Number(raw);
  return Number.isFinite(speed) ? Math.round((Math.min(15, Math.max(0, speed)) / 15) * 100) : null;
}
function fanActual(fan: string) {
  const speed = fanPercent(fan);
  return speed === null ? "—" : `${speed}%`;
}
async function setFan(fan: string) {
  const endpoint = base.value;
  const speed = fanValues[fan];
  await run(async () => {
    await api(endpoint + "/control", form({ cmd: "set_fan", fan, speed }));
    if (endpoint === base.value && fanValues[fan] === speed) fanEdited[fan] = false;
    showNotice("Command sent to printer");
  });
}
async function confirmPrintControl() {
  const command = modal.value;
  if (command !== "pause" && command !== "stop") return;
  await run(async () => {
    await api(base.value + "/control", form({ cmd: command }));
    modal.value = "";
    showNotice("Command sent to printer");
  });
}
watch([base, connecting], ([, isConnecting], [oldBase]) => {
  if (isConnecting || base.value !== oldBase) {
    modal.value = "";
    for (const fan of Object.keys(fanFields)) {
      fanEdited[fan] = false;
      fanValues[fan] = fanPercent(fan) ?? 0;
    }
  }
});
</script>
<template>
  <div class="overview-grid">
    <CameraView :base="base" :connected="connected" />
    <section class="job panel">
      <div class="panel-heading">
        <h2>Current print</h2>
        <span class="badge">{{ p.gcode_state || "No signal" }}</span>
      </div>
      <div class="job-body">
        <PrintPreview
          v-if="p.subtask_name || p.gcode_file || status.metadata?.filename"
          :base="base"
          :connected="connected"
          :current-layer="Number(p.layer_num) || 0"
          :job-key="
            JSON.stringify([
              status.print_run,
              p.task_id,
              p.subtask_id,
              p.gcode_file,
              p.subtask_name,
            ])
          "
          :skipped="skippedObjects"
        />
        <h3>
          {{ p.subtask_name || p.gcode_file || "No active print" }}
        </h3>
        <p>
          {{ status.stage_message || "Print status appears when your printer connects." }}
        </p>
        <div class="progress-label">
          <strong>{{ value(p.mc_percent, "%") }}</strong
          ><span v-if="remaining" class="progress-time"
            >{{ remaining }}<small v-if="finish">{{ finish }}</small></span
          >
        </div>
        <progress :value="p.mc_percent || 0" max="100" aria-label="Print progress" />
        <div class="job-meta">
          <span
            >Layer <b>{{ value(p.layer_num) }} / {{ value(p.total_layer_num) }}</b></span
          ><span
            >Speed <b>{{ value(p.spd_mag, "%") }}</b></span
          ><span v-if="skippedObjects.length"
            >Skipped <b>{{ skippedObjects.length }}</b></span
          >
        </div>
        <div class="job-controls">
          <button
            :disabled="!connected || busy || p.gcode_state !== 'RUNNING'"
            @click="modal = 'pause'"
          >
            <Pause :size="16" />Pause</button
          ><button
            :disabled="!connected || busy || p.gcode_state !== 'PAUSE'"
            @click="control('resume')"
          >
            <Play :size="16" />Resume</button
          ><button
            class="danger-subtle"
            :disabled="!connected || busy || !['RUNNING', 'PAUSE'].includes(p.gcode_state)"
            @click="modal = 'stop'"
          >
            <Square :size="15" />Stop
          </button>
        </div>
      </div>
    </section>
  </div>
  <div v-if="status.hms?.active" class="banner error">
    <AlertCircle :size="20" />
    <div>
      <strong>{{ status.hms.message }}</strong>
      <p>{{ status.hms.description }}</p>
      <a v-for="url in status.hms.urls" :href="url" target="_blank" rel="noopener noreferrer"
        >Printer troubleshooting ↗</a
      >
    </div>
  </div>
  <div class="control-grid">
    <section class="panel">
      <div class="panel-heading">
        <h2><Thermometer :size="18" />Temperature</h2>
        <select
          v-if="caps.num_extruders > 1"
          v-model.number="nozzleIndex"
          aria-label="Nozzle index"
          class="nozzle-select"
        >
          <option v-for="index in caps.num_extruders" :value="index - 1">
            Nozzle {{ index }}
          </option></select
        ><span class="muted">Current / target</span>
      </div>
      <div v-for="target in tempTargets" :key="target" class="control-row">
        <div>
          <strong class="capitalize">{{ target }}</strong
          ><small
            >{{ temperature(p[target + "_temper"]) }}
            <span>/ {{ temperature(p[target + "_target_temper"]) }}</span></small
          >
        </div>
        <form
          class="inline-control"
          @submit.prevent="
            control('set_temp', {
              target,
              temp: temps[target],
              index: nozzleIndex,
            })
          "
        >
          <label :for="'temp-' + target" class="sr-only">{{ target }} target temperature</label
          ><input
            :id="'temp-' + target"
            v-model="temps[target]"
            type="number"
            min="0"
            :max="
              target === 'nozzle'
                ? caps.max_nozzle_temp || 300
                : target === 'bed'
                  ? caps.max_bed_temp || 120
                  : caps.max_chamber_temp || 60
            "
            :disabled="!connected"
          /><button :disabled="!connected || busy">Set</button>
        </form>
      </div>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <h2><Fan :size="18" />Air & speed</h2>
      </div>
      <form v-for="fan in fanTargets" class="fan-row" @submit.prevent="setFan(fan)">
        <label :for="'fan-' + fan" class="fan-label"
          ><span class="capitalize">{{ fan }} fan</span
          ><small>Actual {{ fanActual(fan) }}</small></label
        ><input
          :id="'fan-' + fan"
          v-model.number="fanValues[fan]"
          @input="fanEdited[fan] = true"
          type="range"
          min="0"
          max="100"
          step="1"
          :disabled="!connected"
        /><span class="fan-target"><small>Target</small>{{ fanValues[fan] }}%</span
        ><button :disabled="!connected || busy">Set</button>
      </form>
      <div class="speed-row">
        <label for="speed">Print speed</label
        ><select
          id="speed"
          :disabled="!connected || busy"
          :value="
            ['', 'speed_silent', 'speed_std', 'speed_sport', 'speed_ludi'][p.spd_lvl] || 'speed_std'
          "
          @change="control(($event.target as HTMLSelectElement).value)"
        >
          <option value="speed_silent">Silent · 50%</option>
          <option value="speed_std">Standard · 100%</option>
          <option value="speed_sport">Sport · 124%</option>
          <option value="speed_ludi">Ludicrous · 166%</option>
        </select>
      </div>
    </section>
  </div>
  <section class="quick-controls">
    <div><Lightbulb :size="19" /><strong>Chamber light</strong></div>
    <button
      :class="{ primary: chamberLight === 'on' }"
      :aria-pressed="chamberLight === null ? undefined : chamberLight === 'on'"
      :disabled="!connected || busy"
      @click="control('light_on')"
    >
      On</button
    ><button
      :disabled="!connected || busy"
      :class="{ primary: chamberLight === 'off' }"
      :aria-pressed="chamberLight === null ? undefined : chamberLight === 'off'"
      @click="control('light_off')"
    >
      Off</button
    ><span class="muted">{{
      p.wifi_signal ? `Wi-Fi ${p.wifi_signal}` : "Wi-Fi status unavailable"
    }}</span>
  </section>
  <AppModal
    v-if="modal"
    :title="modal === 'pause' ? 'Pause this print?' : 'Stop this print?'"
    @close="modal = ''"
  >
    <p>
      {{
        modal === "pause"
          ? "Pause the current print? You can resume it later."
          : "The current print will end and cannot be resumed."
      }}
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="modal-actions">
      <button @click="modal = ''">Cancel</button
      ><button
        :class="modal === 'pause' ? 'primary' : 'danger'"
        :disabled="busy || !connected"
        @click="confirmPrintControl"
      >
        {{ modal === "pause" ? "Pause print" : "Stop print" }}
      </button>
    </div>
  </AppModal>
</template>
