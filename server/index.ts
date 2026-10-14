import { app } from "./app";
import { tls } from "./config";
import { db } from "./store";
import { restartEngine, shutdownEngine } from "./engine";
app.listen({
  hostname: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  tls,
});
console.info(`BambuDeck listening on port ${app.server?.port}`);
void restartEngine().catch(() =>
  console.warn("Printer engine is unavailable; profile management remains available."),
);
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  await shutdownEngine();
  await app.stop(true);
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
