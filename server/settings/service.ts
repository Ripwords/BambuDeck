import { settings, setConfig } from "../store";
import { restartEngine } from "../engine";
import type { SettingsInput } from "./model";
let settingsWork: Promise<unknown> = Promise.resolve();
export function updateSettings(input: SettingsInput) {
  const work = settingsWork.then(async () => {
    setConfig("settings", {
      ...input,
      mqttPrefix: input.mqttPrefix || "homeassistant",
      mqttPassword: input.mqttPassword || settings().mqttPassword,
    });
    await restartEngine();
  });
  settingsWork = work.catch(() => {});
  return work;
}
