import { randomUUID } from "node:crypto";
import { printer, printers, type Printer } from "../store";
import { ApiError } from "../http";
import type { CreatePrinterInput, UpdatePrinterInput } from "./model";
export function profileBody(
  value: CreatePrinterInput | UpdatePrinterInput,
  current?: Printer,
): Printer {
  const profile = {
    id: current?.id || randomUUID(),
    name: value.name,
    host: value.host || current?.host || "",
    serial: value.serial || current?.serial || "",
    code: value.code || current?.code || "",
  };
  if (
    printers().some(
      (saved) =>
        saved.id !== current?.id && saved.serial.toLowerCase() === profile.serial.toLowerCase(),
    )
  )
    throw new ApiError(409, "A profile for this serial number already exists.");
  return profile;
}
export function requirePrinter(id: string) {
  const value = printer(id);
  if (!value) throw new ApiError(404, "Printer profile not found.");
  return value;
}
