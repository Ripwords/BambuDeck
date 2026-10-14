import { ref, reactive, computed, watch, onUnmounted } from "vue";
import { api, form, merge } from "../api";
import type { Profile } from "../types";
import type { useFeedback } from "./useFeedback";
export function usePrinter(feedback: ReturnType<typeof useFeedback>) {
  const { run, error, showNotice } = feedback;
  const profiles = ref<Profile[]>([]),
    selected = ref(""),
    tab = ref("Overview"),
    connected = ref(false),
    connecting = ref(false),
    status = reactive<Record<string, any>>({});
  const profile = computed(() => profiles.value.find((p) => p.id === selected.value)),
    base = computed(() => `/api/printers/${encodeURIComponent(selected.value)}/b`),
    p = computed(() => status.print || {}),
    caps = computed(() => status.capabilities || {});
  let events: EventSource | undefined;
  let connectionEpoch = 0;
  async function loadProfiles() {
    profiles.value = await api("/api/printers");
    if (!profiles.value.some((v) => v.id === selected.value))
      selected.value = profiles.value[0]?.id || "";
  }
  async function connect() {
    const epoch = ++connectionEpoch;
    const id = selected.value;
    const endpoint = base.value;
    events?.close();
    connected.value = false;
    connecting.value = false;
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
      events.addEventListener("error", () => {
        if (epoch === connectionEpoch) connected.value = false;
      });
    } catch (e) {
      if (epoch === connectionEpoch) error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (epoch === connectionEpoch) connecting.value = false;
    }
  }
  async function control(cmd: string, values: Record<string, unknown> = {}) {
    await run(async () => {
      await api(base.value + "/control", form({ cmd, ...values }));
      showNotice("Command sent to printer");
    });
  }
  function disconnect() {
    connectionEpoch++;
    events?.close();
    connected.value = false;
    connecting.value = false;
    selected.value = "";
    profiles.value = [];
    for (const key of Object.keys(status)) delete status[key];
  }
  watch(selected, () => void connect());
  onUnmounted(() => {
    connectionEpoch++;
    events?.close();
  });
  return {
    profiles,
    selected,
    tab,
    connected,
    connecting,
    status,
    profile,
    base,
    p,
    caps,
    loadProfiles,
    connect,
    disconnect,
    control,
  };
}
