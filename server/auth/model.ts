import { z } from "../validation";
const message = "Password must contain 12–256 characters.";
export const passwordSchema = z.object({
  password: z.string({ error: message }).min(12, message).max(256, message),
});
export type PasswordInput = z.infer<typeof passwordSchema>;
