import { Elysia } from "elysia";
import { json, body } from "../http";
import { settings } from "../store";
import { engineReady } from "../engine";
import { parse } from "../validation";
import { settingsSchema } from "./model";
import { updateSettings } from "./service";
export const settingsRoutes = new Elysia({ prefix: "/api/settings" })
  .get("", () => {
    const config = settings();
    return json({
      mqttBroker: config.mqttBroker,
      mqttUser: config.mqttUser,
      mqttPrefix: config.mqttPrefix,
      mqttPasswordSet: !!config.mqttPassword,
    });
  })
  .put(
    "",
    async ({ request }) => {
      await updateSettings(parse(settingsSchema, await body(request)));
      return json({ ok: true, engineReady: engineReady() });
    },
    { parse: "none" },
  );
