import { z, cleanText } from "../validation";
export const settingsSchema = z.object({
  mqttBroker: cleanText("MQTT broker").refine((value) => {
    if (!value) return true;
    if (!/^(tcp|ssl|tls|ws|wss):\/\/[^\s]+$/.test(value)) return false;
    try {
      const url = new URL(value);
      return !!url.hostname && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "MQTT broker must use tcp://, ssl://, tls://, ws://, or wss:// without embedded credentials."),
  mqttUser: cleanText("MQTT username"),
  mqttPrefix: cleanText("MQTT prefix", 128).regex(
    /^[^+#]*$/,
    "MQTT prefix cannot contain wildcards.",
  ),
  mqttPassword: z
    .string({ error: "Invalid MQTT password." })
    .max(1024, "Invalid MQTT password.")
    .regex(/^[^\u0000]*$/, "Invalid MQTT password.")
    .optional()
    .default(""),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
