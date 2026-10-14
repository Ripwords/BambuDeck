<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from "vue";
import {
  Box,
  LayoutDashboard,
  FolderOpen,
  Layers3,
  Settings2,
  Plus,
  ArrowUpRight,
  RefreshCw,
  Wifi,
  Moon,
  Sun,
  LogOut,
  ShieldCheck,
  Printer,
  Pause,
  Play,
  Square,
  Lightbulb,
  Thermometer,
  Fan,
  ChevronRight,
  AlertCircle,
  Trash2,
  Pencil,
  Download,
  Upload,
  FolderPlus,
  ArrowLeft,
  SlidersHorizontal,
} from "lucide-vue-next";
import { api, form, merge } from "./api";
import { useRegisterSW } from "virtual:pwa-register/vue";
const { needRefresh, updateServiceWorker } = useRegisterSW();
import CameraView from "./components/CameraView.vue";
import AppModal from "./components/AppModal.vue";
import AdvancedPanel from "./components/AdvancedPanel.vue";
interface Profile {
  id: string;
  name: string;
  hostMasked: string;
  serialMasked: string;
}
const auth = reactive({
    ready: false,
    setupRequired: false,
    authenticated: false,
  }),
  password = ref(""),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const profiles = ref<Profile[]>([]),
  selected = ref(""),
  tab = ref("Overview"),
  connected = ref(false),
  connecting = ref(false),
  status = reactive<Record<string, any>>({}),
  dark = ref(localStorage.getItem("theme") === "dark");
const profile = computed(() =>
    profiles.value.find((p) => p.id === selected.value),
  ),
  base = computed(
    () => `/api/printers/${encodeURIComponent(selected.value)}/b`,
  ),
  p = computed(() => status.print || {}),
  caps = computed(() => status.capabilities || {});
const modal = ref(""),
  editing = ref(""),
  printerForm = reactive({ name: "", host: "", serial: "", code: "" });
const files = ref<any[]>([]),
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
  bedType = ref("auto");
const settings = reactive({
  mqttBroker: "",
  mqttUser: "",
  mqttPassword: "",
  mqttPrefix: "homeassistant",
  mqttPasswordSet: false,
});
const nozzleIndex = ref(0);
const tempTargets = computed(() =>
  caps.value.has_chamber_heater
    ? ["nozzle", "bed", "chamber"]
    : ["nozzle", "bed"],
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
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Files", icon: FolderOpen },
  { name: "Filament", icon: Layers3 },
  { name: "Settings", icon: Settings2 },
];
let events: EventSource | undefined,
  connectionEpoch = 0;
async function run(task: () => Promise<void>) {
  error.value = "";
  busy.value = true;
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
async function loadProfiles() {
  profiles.value = await api("/api/printers");
  if (!profiles.value.some((v) => v.id === selected.value))
    selected.value = profiles.value[0]?.id || "";
}
async function authenticate() {
  await run(async () => {
    await api(`/api/auth/${auth.setupRequired ? "setup" : "login"}`, {
      password: password.value,
    });
    password.value = "";
    auth.authenticated = true;
    auth.setupRequired = false;
    await loadProfiles();
  });
}
async function logout() {
  await run(async () => {
    await api("/api/auth/logout", {});
    connectionEpoch++;
    events?.close();
    connected.value = false;
    selected.value = "";
    profiles.value = [];
    for (const key of Object.keys(status)) delete status[key];
    auth.authenticated = false;
  });
}
async function connect() {
  const epoch = ++connectionEpoch;
  const id = selected.value;
  const endpoint = base.value;
  events?.close();
  connected.value = false;
  for (const key of Object.keys(status)) delete status[key];
  if (!id) return;
  connecting.value = true;
  error.value = "";
  try {
    await api(`/api/printers/${id}/connect`, {});
    if (epoch !== connectionEpoch) return;
    const current = await api(endpoint + "/status");
    if (epoch !== connectionEpoch) return;
    merge(status, current);
    connected.value = current.connected === true;
    events = new EventSource(endpoint + "/events");
    events.addEventListener("status_update", (event) => {
      if (epoch === connectionEpoch) {
        const update = JSON.parse((event as MessageEvent).data);
        merge(status, update);
        connected.value = status.connected === true;
      }
    });
    events.onerror = () => {
      if (epoch === connectionEpoch) connected.value = false;
    };
    if (tab.value === "Files" && connected.value) await loadFiles();
  } catch (e) {
    if (epoch === connectionEpoch)
      error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (epoch === connectionEpoch) connecting.value = false;
  }
}
watch(modal, (value) => {
  if (value !== "printer") {
    printerForm.host = "";
    printerForm.serial = "";
    printerForm.code = "";
  }
});
watch(selected, () => {
  directory.value = "/";
  files.value = [];
  void connect();
});
watch(
  dark,
  (value) => {
    document.documentElement.dataset.theme = value ? "dark" : "light";
    localStorage.setItem("theme", value ? "dark" : "light");
  },
  { immediate: true },
);
watch(tab, async (value) => {
  if (value === "Files" && connected.value) await run(loadFiles);
  if (value === "Settings")
    await run(async () => Object.assign(settings, await api("/api/settings")));
});
async function control(cmd: string, values: Record<string, unknown> = {}) {
  await run(async () => {
    await api(base.value + "/control", form({ cmd, ...values }));
    notice.value = "Command sent to printer";
  });
}
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
async function loadFiles() {
  filesLoading.value = true;
  try {
    files.value =
      (await api<any[]>(
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
    notice.value = "File uploaded";
  });
  (event.target as HTMLInputElement).value = "";
}
async function fileAction() {
  await run(async () => {
    if (modal.value === "mkdir")
      await api(
        base.value + "/mkdir",
        form({ path: filePath(fileName.value) }),
      );
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
  modal.value = "print";
  if (/\.3mf$/i.test(path))
    await run(async () => {
      metadata.value = await api(
        base.value + "/metadata?file=" + encodeURIComponent(path),
      );
    });
}
async function startPrint() {
  await run(async () => {
    const data = new FormData();
    for (const [key, val] of Object.entries({
      existing_path: printTarget.value,
      bed_type: bedType.value,
      ...flags,
    }))
      data.set(key, String(val));
    await api(base.value + "/print", data);
    modal.value = "";
    tab.value = "Overview";
    notice.value = "Print request sent";
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
const ams = computed(() => p.value.ams?.ams || []);
function value(input: unknown, suffix = "") {
  return input === undefined || input === null ? "—" : `${input}${suffix}`;
}
function fanActual(fan: string) {
  if (!connected.value) return "—";
  const key = {
    part: "cooling_fan_speed",
    aux: "big_fan1_speed",
    chamber: "big_fan2_speed",
  }[fan];
  const raw = key ? p.value[key] : undefined;
  if (raw === undefined || raw === null || raw === "") return "—";
  const speed = Number(raw);
  return Number.isFinite(speed)
    ? `${Math.round((Math.min(15, Math.max(0, speed)) / 15) * 100)}%`
    : "—";
}
function size(bytes: number) {
  return bytes > 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
onMounted(async () => {
  await run(async () => {
    Object.assign(auth, await api("/api/auth/status"));
    if (auth.authenticated) await loadProfiles();
  });
  auth.ready = true;
});
onUnmounted(() => {
  connectionEpoch++;
  events?.close();
});
</script>
<template>
  <div v-if="!auth.ready" class="boot">Loading…</div>
  <main v-else-if="!auth.authenticated" class="auth-page">
    <div class="auth-brand"><Box :size="28" />BambuDeck</div>
    <section class="auth-card">
      <h1>{{ auth.setupRequired ? "Set password" : "Sign in" }}</h1>
      <form @submit.prevent="authenticate">
        <label
          >{{
            auth.setupRequired
              ? "Create dashboard password"
              : "Dashboard password"
          }}<input
            v-model="password"
            type="password"
            :minlength="auth.setupRequired ? 12 : 1"
            required
            :autocomplete="
              auth.setupRequired ? 'new-password' : 'current-password'
            "
            placeholder="Enter your password"
        /></label>
        <p v-if="auth.setupRequired" class="help">
          Use at least 12 characters. This protects access to every printer.
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary full" :disabled="busy">
          {{
            busy
              ? "Signing in…"
              : auth.setupRequired
                ? "Set password"
                : "Sign in"
          }}<ArrowUpRight :size="18" />
        </button>
      </form>
    </section>
  </main>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <a href="#" class="brand" @click.prevent="tab = 'Overview'"
        ><Box :size="28" />BambuDeck</a
      >
      <div class="workspace-label">Printers</div>
      <nav aria-label="Main navigation">
        <button
          v-for="item in nav"
          :key="item.name"
          :class="{ active: tab === item.name }"
          @click="tab = item.name"
        >
          <component :is="item.icon" :size="19" /><span>{{ item.name }}</span
          ><ChevronRight
            v-if="tab === item.name"
            class="nav-arrow"
            :size="15"
          />
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-actions">
          <button
            class="icon-button"
            :aria-label="dark ? 'Use light theme' : 'Use dark theme'"
            @click="dark = !dark"
          >
            <Sun v-if="dark" :size="18" /><Moon v-else :size="18" /></button
          ><button class="text-button" @click="logout">
            <LogOut :size="16" />Sign out
          </button>
        </div>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div v-if="profiles.length" class="header-printer">
          <div class="header-printer-icon"><Printer :size="21" /></div>
          <label class="header-printer-picker">
            <span class="sr-only">Selected printer</span>
            <select v-model="selected">
              <option v-for="item in profiles" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
            <small>
              {{ caps.display_name || p.device_model || "Bambu Lab printer" }}
              <span>· {{ profile?.hostMasked }}</span>
            </small>
          </label>
        </div>
        <div v-else class="header-brand"><Box :size="23" />BambuDeck</div>
        <div class="topbar-right">
          <template v-if="profiles.length">
            <span class="connection" role="status">
              <i :class="{ online: connected }" />
              {{ connecting ? "Connecting" : connected ? "Connected" : "Offline" }}
            </span>
            <button
              class="icon-button"
              aria-label="Reconnect printer"
              :disabled="connecting"
              @click="connect"
            >
              <RefreshCw :size="18" :class="{ spinning: connecting }" />
            </button>
          </template>
          <button
            class="icon-button"
            :aria-label="dark ? 'Use light theme' : 'Use dark theme'"
            @click="dark = !dark"
          >
            <Sun v-if="dark" :size="18" /><Moon v-else :size="18" />
          </button>
        </div>
      </header>
      <main class="workspace">
        <div class="page-heading">
          <div>
            <h1>{{ tab }}</h1>
          </div>
          <button
            v-if="tab === 'Settings' || !profiles.length"
            class="primary"
            @click="editPrinter()"
          >
            <Plus :size="18" />Add printer
          </button>
        </div>
        <div v-if="needRefresh" class="banner success" role="status">
          <span>A dashboard update is ready.</span
          ><button class="text-button" @click="updateServiceWorker(true)">
            Reload now</button
          ><button class="text-button" @click="needRefresh = false">
            Later
          </button>
        </div>
        <div v-if="error" class="banner error" role="alert">
          <AlertCircle :size="19" /><span>{{ error }}</span
          ><button class="text-button" @click="error = ''">Dismiss</button>
        </div>
        <div v-if="notice" class="banner success" role="status">
          <span>{{ notice }}</span
          ><button class="text-button" @click="notice = ''">Dismiss</button>
        </div>
        <section
          v-if="!profiles.length && tab !== 'Settings'"
          class="empty-workshop"
        >
          <div class="empty-printer">
            <Printer :size="68" :stroke-width="1" />
          </div>
          <h2>Add a printer</h2>
          <p>Enter your printer’s LAN connection details to get started.</p>
          <button class="primary" @click="editPrinter()">
            <Plus :size="18" />Add printer</button
          ><small
            >Find its IP, serial number, and LAN access code in printer
            settings.</small
          >
        </section>
        <template v-else-if="tab === 'Overview'"
          ><div class="overview-grid">
            <CameraView :base="base" :connected="connected" />
            <section class="job panel">
              <div class="panel-heading">
                <h2>Current print</h2>
                <span class="badge">{{ p.gcode_state || "No signal" }}</span>
              </div>
              <div class="job-body">
                <div class="job-object">
                  <Box :size="45" :stroke-width="1.2" />
                </div>
                <h3>
                  {{ p.subtask_name || p.gcode_file || "No active print" }}
                </h3>
                <p>
                  {{
                    status.stage_message ||
                    "Print status appears when your printer connects."
                  }}
                </p>
                <div class="progress-label">
                  <strong>{{ value(p.mc_percent, "%") }}</strong
                  ><span>{{ value(p.mc_remaining_time, " min left") }}</span>
                </div>
                <progress
                  :value="p.mc_percent || 0"
                  max="100"
                  aria-label="Print progress"
                />
                <div class="job-meta">
                  <span
                    >Layer
                    <b
                      >{{ value(p.layer_num) }} /
                      {{ value(p.total_layer_num) }}</b
                    ></span
                  ><span
                    >Speed <b>{{ value(p.spd_mag, "%") }}</b></span
                  >
                </div>
                <div class="job-controls">
                  <button
                    :disabled="
                      !connected || busy || p.gcode_state !== 'RUNNING'
                    "
                    @click="control('pause')"
                  >
                    <Pause :size="16" />Pause</button
                  ><button
                    :disabled="!connected || busy || p.gcode_state !== 'PAUSE'"
                    @click="control('resume')"
                  >
                    <Play :size="16" />Resume</button
                  ><button
                    class="danger-subtle"
                    :disabled="
                      !connected ||
                      busy ||
                      !['RUNNING', 'PAUSE'].includes(p.gcode_state)
                    "
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
              <a
                v-for="url in status.hms.urls"
                :href="url"
                target="_blank"
                rel="noopener noreferrer"
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
                  <option
                    v-for="index in caps.num_extruders"
                    :value="index - 1"
                  >
                    Nozzle {{ index }}
                  </option></select
                ><span class="muted">Current / target</span>
              </div>
              <div
                v-for="target in tempTargets"
                :key="target"
                class="control-row"
              >
                <div>
                  <strong class="capitalize">{{ target }}</strong
                  ><small
                    >{{ value(p[target + "_temper"], "°") }}
                    <span
                      >/ {{ value(p[target + "_target_temper"], "°") }}</span
                    ></small
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
                  <label :for="'temp-' + target" class="sr-only"
                    >{{ target }} target temperature</label
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
              <form
                v-for="fan in fanTargets"
                class="fan-row"
                @submit.prevent="
                  control('set_fan', { fan, speed: fanValues[fan] })
                "
              >
                <label :for="'fan-' + fan" class="fan-label"
                  ><span class="capitalize">{{ fan }} fan</span
                  ><small>Actual {{ fanActual(fan) }}</small></label
                ><input
                  :id="'fan-' + fan"
                  v-model="fanValues[fan]"
                  type="range"
                  min="0"
                  max="100"
                  step="10"
                  :disabled="!connected"
                /><span class="fan-target"
                  ><small>Target</small>{{ fanValues[fan] }}%</span
                ><button :disabled="!connected || busy">Set</button>
              </form>
              <div class="speed-row">
                <label for="speed">Print speed</label
                ><select
                  id="speed"
                  :disabled="!connected || busy"
                  :value="
                    [
                      '',
                      'speed_silent',
                      'speed_std',
                      'speed_sport',
                      'speed_ludi',
                    ][p.spd_lvl] || 'speed_std'
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
            <button :disabled="!connected || busy" @click="control('light_on')">
              On</button
            ><button
              :disabled="!connected || busy"
              @click="control('light_off')"
            >
              Off</button
            ><span class="muted">{{
              p.wifi_signal
                ? `Wi-Fi ${p.wifi_signal}`
                : "Wi-Fi status unavailable"
            }}</span>
          </section>
        </template>
        <template v-else-if="tab === 'Files'"
          ><section class="panel files-panel">
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
                ><label
                  class="button primary"
                  :class="{ disabled: !connected || busy }"
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
            <p v-if="filesLoading" class="empty-inline">
              Loading printer storage…
            </p>
            <p v-else-if="!files.length" class="empty-inline">
              {{
                connected
                  ? "This folder is empty. Upload a file to get started."
                  : "Connect your printer to browse its storage."
              }}
            </p>
            <div v-for="file in files" :key="file.Name" class="file-row">
              <FolderOpen v-if="file.Type === 'dir'" :size="23" /><Box
                v-else
                :size="23"
              />
              <div class="file-info">
                <button
                  v-if="file.Type === 'dir'"
                  class="file-name"
                  @click="openFolder(filePath(file.Name) + '/')"
                >
                  {{ file.Name }}</button
                ><strong v-else>{{ file.Name }}</strong
                ><small>{{
                  file.Type === "dir" ? "Folder" : size(file.Size || 0)
                }}</small>
              </div>
              <div class="file-actions">
                <button
                  v-if="/\.(3mf|gcode)$/i.test(file.Name)"
                  :disabled="!connected || busy"
                  @click="preparePrint(filePath(file.Name))"
                >
                  <Play :size="15" /><span>Print</span></button
                ><a
                  v-if="file.Type !== 'dir'"
                  class="icon-button"
                  :href="
                    base +
                    '/download?path=' +
                    encodeURIComponent(filePath(file.Name))
                  "
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
            <div v-if="status.upload_status?.uploading" class="upload-progress">
              <span
                >Uploading {{ status.upload_status.filename }} ·
                {{ Math.round(status.upload_status.percent) }}%</span
              ><progress max="100" :value="status.upload_status.percent" />
            </div></section
        ></template>
        <template v-else-if="tab === 'Filament'"
          ><div class="section-heading">
            <h2>Automatic Material System</h2>
            <button
              :disabled="!connected || busy"
              @click="
                run(async () => {
                  await api(base + '/filament', form({ action: 'unload' }));
                  notice = 'Unload request sent';
                })
              "
            >
              Unload filament
            </button>
          </div>
          <section v-for="unit in ams" :key="unit.id" class="panel ams-panel">
            <div class="panel-heading">
              <h2>AMS {{ Number(unit.id) + 1 }}</h2>
              <span class="muted"
                >Humidity
                {{
                  unit.humidity_raw
                    ? unit.humidity_raw + "%"
                    : unit.humidity + " / 5"
                }}
                · {{ unit.temp }}°C</span
              >
            </div>
            <div class="spool-grid">
              <div v-for="tray in unit.tray" :key="tray.id" class="spool">
                <div class="spool-ring">
                  <span>{{ Number(tray.id) + 1 }}</span>
                </div>
                <h3>{{ tray.tray_type || "Empty slot" }}</h3>
                <p>
                  {{
                    tray.tray_sub_brands ||
                    tray.tray_info_idx ||
                    "No material reported"
                  }}
                </p>
                <small
                  >{{
                    tray.remain >= 0
                      ? tray.remain + "% remaining"
                      : "Remaining unknown"
                  }}
                  · {{ tray.tray_color || "—" }}</small
                ><button
                  :disabled="!connected || busy"
                  @click="
                    run(async () => {
                      await api(
                        base + '/filament',
                        form({
                          action: 'load',
                          target: Number(unit.id) * 4 + Number(tray.id),
                        }),
                      );
                      notice = 'Load request sent';
                    })
                  "
                >
                  Load spool
                </button>
              </div>
            </div>
          </section>
          <section v-if="!ams.length" class="panel empty-inline">
            <Layers3 :size="32" />
            <h3>No AMS reported</h3>
            <p>Connected material systems appear here automatically.</p>
          </section>
          <section class="panel external-spool">
            <div>
              <h2>External spool</h2>
              <p>{{ p.vt_tray?.tray_type || "Manual filament feed" }}</p>
            </div>
            <button
              :disabled="!connected || busy"
              @click="
                run(async () => {
                  await api(
                    base + '/filament',
                    form({ action: 'load', target: 254 }),
                  );
                  notice = 'External spool load requested';
                })
              "
            >
              Load external
            </button>
          </section>
          <AdvancedPanel
            :base="base"
            :connected="connected"
            mode="filament"
            :status="status"
            @error="error = $event"
            @notice="notice = $event"
        /></template>
        <template v-else-if="tab === 'Settings'"
          ><section class="panel">
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
              <button @click="editPrinter(item)">
                <Pencil :size="15" />Edit
              </button>
            </div>
          </section>
          <section class="panel settings-panel">
            <div>
              <h2>Home Assistant</h2>
              <p>
                Publish printer status and controls through your MQTT broker.
              </p>
            </div>
            <form
              class="settings-form"
              @submit.prevent="
                run(async () => {
                  await api('/api/settings', settings, 'PUT');
                  settings.mqttPassword = '';
                  notice = 'MQTT settings saved. Reconnecting printer…';
                  await connect();
                })
              "
            >
              <label
                >MQTT broker<input
                  v-model="settings.mqttBroker"
                  placeholder="tcp://192.168.1.10:1883" /></label
              ><label
                >Discovery prefix<input
                  v-model="settings.mqttPrefix"
                  placeholder="homeassistant" /></label
              ><label
                >Username<input
                  v-model="settings.mqttUser"
                  autocomplete="off" /></label
              ><label
                >Password<input
                  v-model="settings.mqttPassword"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="
                    settings.mqttPasswordSet
                      ? 'Saved · leave blank to retain'
                      : 'Broker password'
                  "
              /></label>
              <p class="help">
                Leave the broker blank to disable the integration.
              </p>
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
            @notice="notice = $event"
          />
          <section class="session-panel">
            <div><h2>Your session</h2></div>
            <button @click="logout"><LogOut :size="16" />Sign out</button>
          </section></template
        >
      </main>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      <button
        v-for="item in nav"
        :class="{ active: tab === item.name }"
        @click="tab = item.name"
      >
        <component :is="item.icon" :size="21" /><span>{{ item.name }}</span>
      </button>
    </nav>
  </div>
  <AppModal
    v-if="modal"
    :title="
      modal === 'printer'
        ? editing
          ? 'Edit printer'
          : 'Add your printer'
        : modal === 'print'
          ? 'Ready to print?'
          : modal === 'stop'
            ? 'Stop this print?'
            : modal === 'delete'
              ? 'Delete from printer?'
              : modal === 'mkdir'
                ? 'New folder'
                : 'Rename file'
    "
    @close="modal = ''"
  >
    <form v-if="modal === 'printer'" @submit.prevent="savePrinter">
      <p class="modal-description">
        Enable LAN mode on your printer. Find these details in its network and
        device settings.
      </p>
      <label
        >Printer name<input
          v-model="printerForm.name"
          required
          placeholder="Printer name" /></label
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
          :placeholder="
            editing ? 'Leave blank to retain' : 'Printer serial number'
          "
          autocomplete="off" /></label
      ><label
        >LAN access code<input
          v-model="printerForm.code"
          type="password"
          :required="!editing"
          :placeholder="
            editing ? 'Leave blank to retain' : '8-character access code'
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
    <form v-else-if="modal === 'print'" @submit.prevent="startPrint">
      <p class="print-filename">{{ printTarget.split("/").pop() }}</p>
      <p class="help">Check that the build plate is clear before starting.</p>
      <section v-if="metadata?.metadata" class="print-metadata">
        <div
          v-for="plate in metadata.metadata.plates"
          :key="plate.id"
          class="metadata-plate"
        >
          <img
            :src="
              base +
              '/thumbnail?key=' +
              encodeURIComponent(
                (metadata.filename || printTarget) + '/' + plate.id,
              )
            "
            alt="Build plate preview"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div>
            <strong>Plate {{ plate.id }}</strong>
            <p v-if="plate.prediction">
              Estimated time: {{ plate.prediction }} seconds
            </p>
            <p v-if="plate.weight">Material: {{ plate.weight }} g</p>
          </div>
        </div>
        <div
          v-for="material in metadata.metadata.filaments"
          class="metadata-filament"
        >
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
        ><input v-model="flags[key]" type="checkbox" />{{
          flagLabels[key]
        }}</label
      >
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button type="button" @click="modal = ''">Cancel</button
        ><button class="primary" :disabled="busy || !connected">
          <Play :size="16" />Start print
        </button>
      </div>
    </form>
    <form
      v-else-if="['mkdir', 'rename'].includes(modal)"
      @submit.prevent="fileAction"
    >
      <label>Name<input v-model="fileName" required pattern="[^/\\]+" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button type="button" @click="modal = ''">Cancel</button
        ><button class="primary" :disabled="busy || !connected">Save</button>
      </div>
    </form>
    <div v-else>
      <p>
        {{
          modal === "stop"
            ? "The current print will end and cannot be resumed."
            : modal === "remove-printer"
              ? "Remove this saved printer and its credentials?"
              : `Permanently delete ${fileTarget}?`
        }}
      </p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button @click="modal = ''">Cancel</button
        ><button
          class="danger"
          :disabled="busy"
          @click="
            modal === 'stop'
              ? control('stop').then(() => (modal = ''))
              : modal === 'remove-printer'
                ? removePrinter()
                : fileAction()
          "
        >
          {{ modal === "stop" ? "Stop print" : "Delete" }}
        </button>
      </div>
    </div>
  </AppModal>
</template>
