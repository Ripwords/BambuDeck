import "zod/compile";
import { z } from "zod";
import { ApiError } from "./http";
export { z };
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, result.error.issues[0]?.message || "Invalid request.");
  return result.data;
}
export const cleanText = (label: string, maximum = 256) =>
  z
    .string({ error: `Invalid ${label}.` })
    .max(maximum, `Invalid ${label}.`)
    .regex(/^[^\u0000-\u001f\u007f]*$/, `Invalid ${label}.`)
    .trim();
