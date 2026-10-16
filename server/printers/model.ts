import { isIP } from "node:net";
import { z, cleanText } from "../validation";
const host = cleanText("host").refine(
  (value) =>
    !value ||
    !!isIP(value) ||
    /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value),
  "Host must be an IP address or hostname without a port or URL scheme.",
);
const serial = cleanText("serial number", 64).regex(/^[a-zA-Z0-9_-]*$/, "Invalid serial number.");
const code = cleanText("LAN access code", 64);
const required = "Name, host, serial number, and LAN access code are required.";
export const createPrinterSchema = z.object({
  name: cleanText("printer name", 80).min(1, required),
  host: host.refine((value) => !!value, required),
  serial: serial.min(1, required),
  code: code.min(1, required),
});
export const updatePrinterSchema = z.object({
  name: createPrinterSchema.shape.name,
  host: host.optional(),
  serial: serial.optional(),
  code: code.optional(),
});
export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;
export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;
export const previewQuerySchema = z.object({
  file: cleanText("preview file", 1024).optional(),
  plate: z
    .string()
    .regex(/^\d+$/, "Invalid plate number.")
    .transform(Number)
    .pipe(z.number().int().min(1).max(10000))
    .optional(),
});
