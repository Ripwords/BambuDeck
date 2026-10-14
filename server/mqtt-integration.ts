import mqtt, { type MqttClient } from "mqtt";
import type { PrinterClient } from "./printer";
import type { Printer, Settings } from "./store";

type Entry = {
  profile: Printer;
  client: PrinterClient;
  unsubscribe: () => void;
  topics: string[];
};
let broker: MqttClient | undefined;
let config: Settings;
const devices = new Map<string, Entry>();
function base(id: string) {
  return `bambudeck/${id}`;
}
function publish(topic: string, value: unknown, retain = true) {
  broker?.publish(topic, typeof value === "string" ? value : JSON.stringify(value), {
    retain,
    qos: 0,
  });
}
function discover(entry: Entry) {
  const id = entry.profile.id,
    topic = base(id);
  const device = {
    identifiers: [`bambudeck_${id}`],
    name: entry.profile.name,
    manufacturer: "Bambu Lab",
    model: "LAN printer",
  };
  const add = (kind: string, key: string, fields: Record<string, unknown>) => {
    const discovery = `${config.mqttPrefix}/${kind}/bambudeck_${id}/${key}/config`;
    entry.topics.push(discovery);
    publish(discovery, {
      unique_id: `bambudeck_${id}_${key}`,
      name: key.replaceAll("_", " "),
      device,
      availability: [
        { topic: "bambudeck/dashboard/availability" },
        { topic: topic + "/availability" },
      ],
      availability_mode: "all",
      ...fields,
    });
  };
  const sensors: [string, string, string?][] = [
    ["progress", "mc_percent", "%"],
    ["remaining_time", "mc_remaining_time", "min"],
    ["layer", "layer_num"],
    ["total_layers", "total_layer_num"],
    ["nozzle_temperature", "nozzle_temper", "°C"],
    ["nozzle_target", "nozzle_target_temper", "°C"],
    ["bed_temperature", "bed_temper", "°C"],
    ["bed_target", "bed_target_temper", "°C"],
    ["chamber_temperature", "chamber_temper", "°C"],
    ["print_state", "gcode_state"],
    ["print_name", "subtask_name"],
    ["speed", "spd_mag", "%"],
  ];
  for (const [key, field, unit] of sensors)
    add("sensor", key, {
      state_topic: topic + "/state",
      value_template: `{{ value_json.print.${field} | default('unknown') }}`,
      ...(unit ? { unit_of_measurement: unit } : {}),
      ...(unit === "°C" ? { device_class: "temperature", state_class: "measurement" } : {}),
    });
  for (const cmd of ["pause", "resume", "stop"])
    add("button", cmd, {
      command_topic: topic + "/command",
      payload_press: JSON.stringify({ cmd }),
      icon: cmd === "stop" ? "mdi:stop" : cmd === "pause" ? "mdi:pause" : "mdi:play",
    });
  add("switch", "chamber_light", {
    command_topic: topic + "/light/set",
    state_topic: topic + "/state",
    value_template:
      "{{ 'ON' if value_json.print.lights_report | default([]) | selectattr('node', 'equalto', 'chamber_light') | selectattr('mode', 'equalto', 'on') | list | length > 0 else 'OFF' }}",
    payload_on: "ON",
    payload_off: "OFF",
  });
  add("select", "speed_profile", {
    command_topic: topic + "/speed/set",
    options: ["silent", "standard", "sport", "ludicrous"],
    state_topic: topic + "/state",
    value_template:
      "{{ {1: 'silent', 2: 'standard', 3: 'sport', 4: 'ludicrous'}.get(value_json.print.spd_lvl | int, 'standard') }}",
  });
  for (const [target, max] of [
    ["nozzle", 300],
    ["bed", 120],
  ] as const)
    add("number", `${target}_target_control`, {
      command_topic: `${topic}/${target}/set`,
      state_topic: topic + "/state",
      value_template: `{{ value_json.print.${target}_target_temper | default(0) }}`,
      min: 0,
      max,
      step: 1,
      unit_of_measurement: "°C",
      mode: "box",
    });
  broker?.subscribe(topic + "/#");
  publish(topic + "/availability", entry.client.connected ? "online" : "offline");
  publish(topic + "/state", entry.client.status());
}
export async function startHomeAssistant(settings: Settings) {
  await stopHomeAssistant();
  config = settings;
  if (!settings.mqttBroker) return;
  const url = settings.mqttBroker.replace(/^tcp:/, "mqtt:").replace(/^(ssl|tls):/, "mqtts:");
  broker = mqtt.connect(url, {
    username: settings.mqttUser || undefined,
    password: settings.mqttPassword || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    queueQoSZero: false,
    will: {
      topic: "bambudeck/dashboard/availability",
      payload: Buffer.from("offline"),
      qos: 0,
      retain: true,
    },
    clientId: `bambudeck_dashboard_${crypto.randomUUID().slice(0, 8)}`,
  });
  broker.on("error", () => {});
  broker.on("connect", () => {
    publish("bambudeck/dashboard/availability", "online");
    for (const entry of devices.values()) {
      entry.topics = [];
      discover(entry);
    }
  });
  broker.on("message", (topic, bytes) => {
    if (bytes.length > 1024) return;
    const [, id, target, set] = topic.split("/");
    const entry = devices.get(id || "");
    if (!entry || !entry.client.connected) return;
    let command: Record<string, unknown> | undefined;
    const payload = bytes.toString();
    if (target === "command") {
      try {
        const value = JSON.parse(payload) as { cmd?: string };
        if (value.cmd && ["pause", "resume", "stop"].includes(value.cmd))
          command = { cmd: value.cmd };
      } catch {
        return;
      }
    } else if (set === "set" && target === "light" && ["ON", "OFF"].includes(payload))
      command = { cmd: payload === "ON" ? "light_on" : "light_off" };
    else if (
      set === "set" &&
      target === "speed" &&
      ["silent", "standard", "sport", "ludicrous"].includes(payload)
    )
      command = {
        cmd: "speed_" + ({ standard: "std", ludicrous: "ludi" }[payload] || payload),
      };
    else if (set === "set" && ["nozzle", "bed"].includes(target || "") && /^\d{1,3}$/.test(payload))
      command = { cmd: "set_temp", target, temp: Number(payload) };
    if (command) void entry.client.command(command).catch(() => {});
  });
}
export function attachHomeAssistant(profile: Printer, client: PrinterClient) {
  detachHomeAssistant(profile.id);
  const entry: Entry = { profile, client, topics: [], unsubscribe: () => {} };
  entry.unsubscribe = client.subscribe((status) => {
    publish(base(profile.id) + "/state", status);
    publish(base(profile.id) + "/availability", client.connected ? "online" : "offline");
  });
  devices.set(profile.id, entry);
  if (broker?.connected) discover(entry);
}
export function detachHomeAssistant(id: string, remove = false) {
  const entry = devices.get(id);
  if (!entry) return;
  entry.unsubscribe();
  publish(base(id) + "/availability", "offline");
  if (remove) {
    for (const topic of entry.topics) publish(topic, "");
    publish(base(id) + "/state", "");
  }
  broker?.unsubscribe(base(id) + "/#");
  devices.delete(id);
}
export async function stopHomeAssistant() {
  const previous = broker;
  if (!previous) return;
  for (const entry of devices.values())
    publish(base(entry.profile.id) + "/availability", "offline");
  publish("bambudeck/dashboard/availability", "offline");
  let force: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    force = setTimeout(() => {
      previous.options.reconnectPeriod = 0;
      previous.stream?.destroy();
      previous.end(true);
      resolve();
    }, 2000);
  });
  try {
    await Promise.race([previous.endAsync(false).catch(() => {}), deadline]);
  } finally {
    clearTimeout(force);
  }
  broker = undefined;
}
