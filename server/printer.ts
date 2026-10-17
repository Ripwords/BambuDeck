import mqtt, { type MqttClient } from "mqtt";
import { randomBytes } from "node:crypto";
import { CameraFeed } from "./camera";
import { z } from "./validation";

export class PrinterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PrinterProfile {
  id: string;
  name: string;
  host: string;
  serial: string;
  code: string;
}
type Fields = Record<string, unknown>;
const skippedObjectsSchema = z
  .array(z.number().int().min(0))
  .min(1)
  .max(256)
  .refine((ids) => new Set(ids).size === ids.length);
type Result = { ok: true; sequence_id: string };
export interface Capabilities {
  display_name: string;
  max_nozzle_temp: number;
  max_bed_temp: number;
  max_chamber_temp: number;
  has_chamber_fan: boolean;
  has_aux_fan: boolean;
  has_chamber_heater: boolean;
  has_chamber_temp: boolean;
  has_ams_humidity: boolean;
  has_ams_capacity_reporting: boolean;
  has_timelapse: boolean;
  has_bed_leveling: boolean;
  min_chamber_temp: number;
  num_extruders: number;
}
const models: Record<string, [string, number, number, number, number]> = {
  "BL-P001": ["X1 Carbon", 300, 110, 0, 1],
  "BL-P002": ["X1", 300, 110, 0, 1],
  C11: ["P1P", 300, 100, 0, 1],
  C12: ["P1S", 300, 100, 0, 1],
  C13: ["X1E", 320, 110, 60, 1],
  N1: ["A1 mini", 300, 80, 0, 1],
  N2S: ["A1", 300, 100, 0, 1],
  N6: ["X2D", 300, 120, 65, 2],
  N7: ["P2S", 300, 110, 0, 1],
  N9: ["A2L", 300, 80, 0, 1],
  O1C: ["H2C", 350, 120, 65, 2],
  O1C2: ["H2C", 350, 120, 65, 2],
  O1D: ["H2D", 350, 120, 65, 2],
  O1E: ["H2D Pro", 350, 120, 65, 2],
  O1S: ["H2S", 350, 120, 65, 1],
};
export function capabilities(model: string): Capabilities {
  const [name, nozzle, bed, chamber, extruders] = models[model] || ["Printer", 300, 80, 0, 1];
  const enclosed = !!models[model] && !["N1", "N2S", "N9"].includes(model);
  return {
    display_name: `Bambu Lab ${name}`,
    max_nozzle_temp: nozzle,
    max_bed_temp: bed,
    max_chamber_temp: chamber,
    min_chamber_temp: 0,
    num_extruders: extruders,
    has_chamber_fan: enclosed,
    has_aux_fan: enclosed,
    has_chamber_heater: chamber > 0,
    has_chamber_temp: chamber > 0,
    has_ams_humidity: enclosed,
    has_ams_capacity_reporting: enclosed,
    has_timelapse: true,
    has_bed_leveling: true,
  };
}
function inferredModel(serial: string) {
  const prefixes: Record<string, string> = {
    "00M": "BL-P001",
    "00W": "BL-P001",
    "001": "BL-P002",
    "01S": "C12",
    "01C": "C12",
    "01P": "C11",
    "030": "N1",
    "03N": "N1",
    "01N": "N2S",
    "039": "C13",
  };
  return prefixes[serial.slice(0, 3).toUpperCase()] || "";
}
function record(value: unknown): value is Fields {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function merge(target: Fields, value: Fields) {
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (record(item)) {
      if (!record(target[key])) target[key] = {};
      merge(target[key] as Fields, item);
    } else target[key] = item;
  }
}
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:password|access.?code|serial|^sn$|^ip$|ip_?addr|rtsp)/i.test(key))
      .map(([key, item]) => [key, scrub(item)]),
  );
}
function number(fields: Fields, key: string, min: number, max: number, integer = true): number {
  const raw = fields[key];
  if (raw === undefined || raw === null || raw === "" || typeof raw === "boolean")
    throw new PrinterError(400, `${key} is required.`);
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new PrinterError(400, `${key} must be ${min}–${max}.`);
  return value;
}
function text(fields: Fields, key: string, max = 256): string {
  const value = fields[key];
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new PrinterError(400, `Invalid ${key}.`);
  return value;
}
function bool(value: unknown): boolean {
  if ([true, "true", "on", "1", 1].includes(value as never)) return true;
  if ([false, "false", "off", "0", 0, undefined, ""].includes(value as never)) return false;
  throw new PrinterError(400, "Invalid boolean option.");
}
function choice(value: unknown, choices: string[]) {
  const selected = String(value);
  if (!choices.includes(selected)) throw new PrinterError(400, `Choose ${choices.join(", ")}.`);
  return selected;
}
const stageLabels = [
  "Printing",
  "Leveling bed",
  "Heating bed",
  "Vibration calibration",
  "Changing filament",
  "G-code pause",
  "Out of filament",
  "Heating nozzle",
  "Dynamic flow calibration",
  "Scanning bed",
  "First-layer inspection",
  "Checking plate type",
  "Lidar calibration",
  "Homing",
  "Cleaning nozzle",
  "Checking extruder temperature",
  "User paused",
  "Front cover open",
  "Lidar calibration",
  "Flow ratio calibration",
  "Nozzle temperature fault",
  "Bed temperature fault",
  "Unloading filament",
  "Motion step loss",
  "Loading filament",
  "Motor noise calibration",
  "AMS disconnected",
  "Heatbreak fan slow",
  "Chamber temperature fault",
  "Cooling chamber",
  "User G-code pause",
  "Motor noise demonstration",
  "Nozzle clump detected",
  "Cutter fault",
  "First-layer fault",
  "Nozzle blocked",
  "Measuring motion precision",
  "Improving motion precision",
  "Measuring motion accuracy",
  "Nozzle offset calibration",
  "Hot bed leveling",
  "Checking release lever",
  "Checking enclosure",
  "Laser calibration",
  "Checking platform",
  "Locating overhead camera",
  "Calibrating overhead camera",
  "Bed leveling: first pass",
  "Bed leveling: second pass",
  "Heating chamber",
  "Cooling bed",
  "Printing calibration lines",
  "Checking material",
  "Calibrating live camera",
  "Waiting for bed temperature",
  "Checking material position",
  "Calibrating cutting offset",
  "Measuring surface",
  "First-layer thermal conditioning",
  "Homing blade holder",
  "Calibrating camera offset",
  "Calibrating blade position",
  "Testing hotend changes",
  "Equalizing chamber temperature",
  "Preparing hotend",
  "Calibrating clump detection",
  "Filtering chamber air",
  "Measuring rotary attachment",
  "Moving to purge chute",
  "Cooling nozzle",
  "Centering toolhead",
  "Arc fitting",
  "Detecting hotend type",
  "Checking plate alignment",
  "Checking bed surface",
  "Checking below bed",
  "Priming nozzle",
  "Preparing AMS",
];
function stageLabel(value: unknown) {
  const id = Number(value);
  return id === -1 || id === 255 ? "Idle" : stageLabels[id];
}
const outOfFilamentStage = 6;
const pauseReasonStages = new Set([
  5,
  outOfFilamentStage,
  16,
  17,
  20,
  21,
  23,
  26,
  27,
  28,
  30,
  32,
  33,
  34,
  35,
]);
function filamentRunout(print: Fields) {
  const code = Number(print.print_error) >>> 0;
  const reported = code >>> 24 === 0x07 && (code & 0xffff) === 0x8011;
  if (!reported && Number(print.stg_cur) !== outOfFilamentStage) return null;
  const external = ((code >>> 16) & 0xff) === 0xff;
  return {
    active: true,
    code: reported
      ? [code >>> 16, code & 0xffff]
          .map((part) => part.toString(16).padStart(4, "0").toUpperCase())
          .join("-")
      : "",
    message: external ? "External spool ran out of filament" : "Filament ran out",
    description: "Load new filament, then resume the print.",
  };
}

export class PrinterClient {
  private transport: MqttClient | null = null;
  private telemetry: Fields = {};
  private listeners = new Set<(status: Fields) => void>();
  private opening: Promise<void> | null = null;
  private closed = false;
  private ready = false;
  private sequence = Date.now();
  private model: string;
  readonly camera: CameraFeed;
  constructor(private readonly profile: PrinterProfile) {
    this.model = inferredModel(profile.serial);
    this.camera = new CameraFeed(profile, () => ({
      model: this.model,
      rtsp: record(this.telemetry.ipcam) ? String(this.telemetry.ipcam.rtsp_url || "") : "",
    }));
  }
  get connected() {
    return this.ready && !!this.transport?.connected;
  }
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.opening) return this.opening;
    if (this.closed) return Promise.reject(new PrinterError(503, "Printer connection was closed."));
    this.opening = new Promise<void>((resolve, reject) => {
      const client =
        this.transport ||
        mqtt.connect({
          protocol: "mqtts",
          host: this.profile.host,
          port: 8883,
          username: "bblp",
          password: this.profile.code,
          rejectUnauthorized: false,
          clientId: `dashboard-${randomBytes(8).toString("hex")}`,
          protocolVersion: 4,
          keepalive: 15,
          connectTimeout: 10000,
          reconnectPeriod: 3000,
          queueQoSZero: false,
          resubscribe: false,
        });
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new PrinterError(504, "Printer connection timed out. Check LAN mode and credentials."),
        );
      }, 15000);
      const connected = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new PrinterError(502, "Printer connection failed. Check LAN mode and credentials."));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(onStatus);
        client.off("error", failed);
      };
      const onStatus = () => {
        if (this.connected) connected();
      };
      this.listeners.add(onStatus);
      client.once("error", failed);
      if (!this.transport) {
        this.transport = client;
        client.on("connect", () => {
          client.subscribe(`device/${this.profile.serial}/report`, { qos: 0 }, (error) => {
            this.ready = !error;
            this.emit();
            if (!error) {
              void this.command({ action: "refresh" }).catch(() => {});
              void this.command({ action: "version" }).catch(() => {});
            }
          });
        });
        client.on("message", (_topic, payload) => this.receive(payload));
        client.on("error", () => {
          this.ready = false;
          this.emit();
        });
        client.on("offline", () => {
          this.ready = false;
          this.emit();
        });
        client.on("close", () => {
          this.ready = false;
          this.emit();
        });
      }
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }
  private receive(payload: Buffer) {
    if (payload.length > 2 * 1024 * 1024) return;
    try {
      const message: unknown = JSON.parse(payload.toString());
      if (!record(message)) return;
      if (record(message.print)) merge(this.telemetry, message.print);
      if (record(message.info) && Array.isArray(message.info.module)) {
        this.telemetry.modules = message.info.module;
        const ota = message.info.module.find(
          (value: unknown) => record(value) && value.name === "ota",
        );
        if (
          !inferredModel(this.profile.serial) &&
          record(ota) &&
          typeof ota.project_name === "string"
        )
          this.model = ota.project_name;
      }
      this.emit();
    } catch {}
  }
  status(): Fields {
    const print = scrub(this.telemetry) as Fields;
    const caps = capabilities(this.model);
    print.device_model = this.model;
    print.bed_temp_limit = caps.max_bed_temp;
    print.nozzle_temp_limit = caps.max_nozzle_temp;
    const state = String(print.gcode_state || "");
    const statusNames: Record<string, string> = {
      PAUSE: "Paused",
      FINISH: "Finished",
      IDLE: "Idle",
      FAILED: "Failed",
    };
    const runout = state === "PAUSE" ? filamentRunout(print) : null;
    const pauseReason = pauseReasonStages.has(Number(print.stg_cur))
      ? stageLabel(print.stg_cur)
      : "";
    const stage =
      (runout && "Out of filament") ||
      (state === "PAUSE" && pauseReason) ||
      statusNames[state] ||
      (state === "RUNNING" && Number(print.layer_num) > 0
        ? "Printing"
        : stageLabel(print.stg_cur) || state || "Waiting for printer");
    const events = Array.isArray(print.hms) ? print.hms.filter(record) : [];
    const codes = events.map((event) =>
      [
        Number(event.code) >>> 16,
        Number(event.code) & 65535,
        Number(event.attr) >>> 16,
        Number(event.attr) & 65535,
      ]
        .map((part) => part.toString(16).padStart(4, "0").toUpperCase())
        .join("-"),
    );
    return {
      print,
      capabilities: caps,
      connected: this.connected,
      stage_message: stage,
      filament_runout: runout,
      metadata: null,
      upload_status: {},
      metadata_download_status: {},
      hms: {
        active: events.length > 0,
        message: codes.join(", "),
        description: codes.length
          ? "Printer reported a hardware message. Open the troubleshooting guide for details."
          : "",
        urls: codes.map(
          (code) =>
            `https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/${code.replaceAll("-", "_")}`,
        ),
      },
    };
  }
  subscribe(callback: (status: Fields) => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  private emit() {
    const snapshot = this.status();
    for (const callback of this.listeners) {
      try {
        callback(snapshot);
      } catch {}
    }
  }
  async close() {
    this.closed = true;
    this.ready = false;
    await this.camera.close();
    const client = this.transport;
    this.transport = null;
    if (client) await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    this.emit();
    this.listeners.clear();
  }
  private async send(section: string, command: string, fields: Fields = {}): Promise<Result> {
    if (!this.connected || !this.transport)
      throw new PrinterError(503, "Printer is offline. Reconnect before sending a command.");
    const sequence_id = String(++this.sequence);
    const payload = JSON.stringify({
      [section]: { command, sequence_id, ...fields },
      user_id: "1234567890",
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new PrinterError(504, "Printer command timed out.")),
        10000,
      );
      this.transport!.publish(
        `device/${this.profile.serial}/request`,
        payload,
        { qos: 0 },
        (error) => {
          clearTimeout(timer);
          if (error) reject(new PrinterError(502, "Printer command could not be sent."));
          else resolve();
        },
      );
    });
    return { ok: true, sequence_id };
  }
  private gcode(line: string) {
    return this.send("print", "gcode_line", { param: line.trimEnd() + "\n" });
  }
  command(input: URLSearchParams | Fields): Promise<Result> {
    const fields: Fields = input instanceof URLSearchParams ? Object.fromEntries(input) : input;
    const action = String(fields.cmd || fields.action || "");
    const caps = capabilities(this.model);
    switch (action) {
      case "pause":
      case "resume":
      case "stop":
        return this.send("print", action);
      case "light_on":
      case "light_off":
        return this.send("system", "ledctrl", {
          led_node: "chamber_light",
          led_mode: action === "light_on" ? "on" : "off",
          led_on_time: 500,
          led_off_time: 500,
          loop_times: 0,
          interval_time: 0,
        });
      case "speed_silent":
      case "speed_std":
      case "speed_sport":
      case "speed_ludi":
        return this.send("print", "print_speed", {
          param: String(
            ["speed_silent", "speed_std", "speed_sport", "speed_ludi"].indexOf(action) + 1,
          ),
        });
      case "refresh":
        return this.send("pushing", "pushall");
      case "version":
        return this.send("info", "get_version");
      case "gcode":
        return this.gcode(text(fields, "gcode", 8192));
      case "set_temp": {
        const target = choice(fields.target, ["nozzle", "bed", "chamber"]);
        if (target === "chamber" && !caps.has_chamber_heater)
          throw new PrinterError(400, "This printer has no chamber heater.");
        const temp = number(
          fields,
          "temp",
          0,
          target === "nozzle"
            ? caps.max_nozzle_temp
            : target === "bed"
              ? caps.max_bed_temp
              : caps.max_chamber_temp,
        );
        const tool = number({ index: fields.index ?? 0 }, "index", 0, caps.num_extruders - 1);
        return this.gcode(
          target === "bed"
            ? `M140 S${temp}`
            : target === "chamber"
              ? `M191 S${temp}`
              : `M104${tool ? ` T${tool}` : ""} S${temp}`,
        );
      }
      case "set_fan": {
        const fan = choice(fields.fan, ["part", "aux", "chamber", "all"]);
        if ((fan === "aux" && !caps.has_aux_fan) || (fan === "chamber" && !caps.has_chamber_fan))
          throw new PrinterError(400, "Fan is not supported by this printer.");
        const speed = Math.floor((number(fields, "speed", 0, 100) * 255) / 100);
        const fans =
          fan === "all"
            ? [1, ...(caps.has_aux_fan ? [2] : []), ...(caps.has_chamber_fan ? [3] : [])]
            : [{ part: 1, aux: 2, chamber: 3 }[fan]!];
        return this.gcode(fans.map((id) => `M106 P${id} S${speed}`).join("\n"));
      }
      case "load": {
        const target = number(fields, "target", 0, 254);
        if (target > 15 && target !== 254)
          throw new PrinterError(400, "Filament slot must be 0–15 or 254.");
        return this.send("print", "ams_change_filament", {
          target,
          curr_temp: 250,
          tar_temp: 250,
        });
      }
      case "unload":
        return this.send("print", "unload_filament");
      case "skip_objects": {
        const objects = skippedObjectsSchema.safeParse(fields.objects);
        if (!objects.success) throw new PrinterError(400, "Select valid object IDs.");
        return this.send("print", "skip_objects", { obj_list: objects.data });
      }
      case "nozzle":
        return this.send("system", "set_accessories", {
          nozzle_diameter: Number(choice(fields.diameter, ["0.2", "0.4", "0.6", "0.8"])),
          nozzle_type: choice(fields.nozzle_type, ["hardened_steel", "stainless_steel"]),
        });
      case "marker":
        return this.send("xcam", "xcam_control_set", {
          control: bool(fields.enabled),
          enable: bool(fields.enabled),
        });
      case "option": {
        const option = choice(fields.option, [
          "auto_recovery",
          "auto_switch_filament",
          "filament_tangle_detect",
          "sound_enable",
        ]);
        const enabled = bool(fields.enabled);
        return this.send("print", "print_option", {
          [option]: enabled,
          ...(option === "auto_recovery" ? { option: Number(enabled) } : {}),
        });
      }
      case "ams_control":
        return this.send("print", "ams_control", {
          param: choice(fields.command, ["resume", "pause", "reset"]),
        });
      case "ams_settings":
        return this.send("print", "ams_user_setting", {
          ams_id: number(fields, "ams_id", 0, 3),
          startup_read_option: bool(fields.startup_read),
          tray_read_option: bool(fields.tray_read),
          calibrate_remain_flag: bool(fields.calibrate_remain),
        });
      case "k_factor": {
        const tray = number(fields, "tray_id", 0, 254);
        if (tray > 15 && tray !== 254)
          throw new PrinterError(400, "Filament slot must be 0–15 or 254.");
        return this.send("print", "extrusion_cali_set", {
          tray_id: tray,
          k_value: number(fields, "k_value", 0, 10, false),
          n_coef: number(fields, "n_coef", 0.001, 10, false),
        });
      }
      case "filament": {
        const ams = number(fields, "ams_id", 0, 255),
          tray = number(fields, "tray_id", 0, 254);
        if (!(ams === 255 && tray === 254) && (ams > 3 || tray > 3))
          throw new PrinterError(400, "Invalid AMS unit or slot.");
        const color = text(fields, "color", 8);
        if (!/^[\da-f]{8}$/i.test(color))
          throw new PrinterError(400, "Color requires eight RGBA hexadecimal digits.");
        const min = number(fields, "min_temp", 0, caps.max_nozzle_temp),
          max = number(fields, "max_temp", min, caps.max_nozzle_temp);
        return this.send("print", "ams_filament_setting", {
          ams_id: ams,
          slot_id: tray,
          tray_id: tray,
          tray_info_idx: text(fields, "filament_id"),
          setting_id: text(fields, "setting_id"),
          tray_color: color,
          tray_type: text(fields, "filament_type"),
          nozzle_temp_min: min,
          nozzle_temp_max: max,
        });
      }
      default:
        throw new PrinterError(400, "Unknown printer command.");
    }
  }
  startPrint(path: string, options: Fields): Promise<Result> {
    if (!path || path.includes("\0") || !/\.(gcode|3mf)$/i.test(path))
      throw new PrinterError(400, "Choose a G-code or 3MF file.");
    const bed = choice(options.bed_type || "auto", [
      "auto",
      "textured_plate",
      "cool_plate",
      "engineering_plate",
      "high_temp_plate",
      "hot_plate",
      "supertack_plate",
    ]);
    const plate = String(options.plate || "1");
    if (!/^[1-9]\d{0,3}$/.test(plate)) throw new PrinterError(400, "Invalid plate.");
    return this.send("print", "project_file", {
      param: /\.gcode$/i.test(path) ? path : `Metadata/plate_${plate}.gcode`,
      subtask_name: path,
      url: `ftp://${path}`,
      bed_type: bed,
      timelapse: bool(options.timelapse),
      bed_leveling: bool(options.bed_leveling),
      flow_cali: bool(options.flow_calibration),
      vibration_cali: bool(options.vibration_calibration),
      layer_inspect: bool(options.layer_inspection),
      use_ams: bool(options.use_ams),
      profile_id: "0",
      project_id: "0",
      subtask_id: "0",
      task_id: "0",
    });
  }
}
