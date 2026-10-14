import { Elysia } from "elysia";
import { body, json } from "../http";
import { printers, publicPrinter, savePrinter, deletePrinter } from "../store";
import { connect, forgetPrinter } from "../engine";
import { createPrinterSchema, updatePrinterSchema } from "./model";
import { profileBody, requirePrinter } from "./service";
import { parse } from "../validation";
import { proxy } from "./operations";
export const printerRoutes = new Elysia({ prefix: "/api/printers" })
  .get("", () => json(printers().map(publicPrinter)))
  .post(
    "",
    async ({ request }) => {
      const profile = profileBody(parse(createPrinterSchema, await body(request)));
      savePrinter(profile);
      return json(publicPrinter(profile), 201);
    },
    { parse: "none" },
  )
  .put(
    "/:id",
    async ({ request, params }) => {
      const profile = requirePrinter(params.id);
      const updated = profileBody(parse(updatePrinterSchema, await body(request)), profile);
      savePrinter(updated);
      await forgetPrinter(profile.id);
      return json(publicPrinter(updated));
    },
    { parse: "none" },
  )
  .delete(
    "/:id",
    async ({ params }) => {
      const profile = requirePrinter(params.id);
      deletePrinter(profile.id);
      await forgetPrinter(profile.id);
      return json({ ok: true });
    },
    { parse: "none" },
  )
  .post(
    "/:id/connect",
    async ({ params }) => {
      await connect(requirePrinter(params.id));
      return json({ ok: true });
    },
    { parse: "none" },
  )
  .all(
    "/:id/camera",
    ({ request, params }) => proxy(request, requirePrinter(params.id), "camera"),
    { parse: "none" },
  )
  .all(
    "/:id/b/:endpoint",
    ({ request, params }) => proxy(request, requirePrinter(params.id), params.endpoint),
    { parse: "none" },
  );
