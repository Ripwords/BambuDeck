import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";
import { ApiError } from "./http";

export interface DiscoveredPrinter {
  host: string;
  serial: string;
  model: string;
}
interface Scan {
  sockets: Set<Socket>;
  printers: Map<string, DiscoveredPrinter>;
  listeners: Set<(printer?: DiscoveredPrinter, error?: ApiError) => void>;
  timer: ReturnType<typeof setTimeout>;
  packets: number;
}
const multicast = "239.255.255.250";
const printerType = "urn:bambulab-com:device:3dprinter:1";
let active: Scan | undefined;

function timeout() {
  const configured = Number(process.env.DISCOVERY_TIMEOUT_MS || 15000);
  if (!Number.isInteger(configured) || configured < 1000 || configured > 60000)
    throw new ApiError(503, "DISCOVERY_TIMEOUT_MS must be an integer from 1000 to 60000.");
  return configured;
}
function unavailable() {
  return new ApiError(
    503,
    "Printer discovery is unavailable. Allow UDP 2021/1990 multicast on the printer LAN, or enter the host manually.",
  );
}
function announcement(message: Buffer, host: string): DiscoveredPrinter | undefined {
  if (message.length > 8192 || !isIPv4(host)) return;
  const lines = message.toString("utf8").split(/\r?\n/);
  if (lines.shift() !== "NOTIFY * HTTP/1.1") return;
  const headers = new Map<string, string>();
  for (const line of lines) {
    if (!line) break;
    const colon = line.indexOf(":");
    if (colon < 1) return;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (headers.has(name)) return;
    headers.set(name, line.slice(colon + 1).trim());
  }
  if (headers.get("nt") !== printerType || headers.get("nts") === "ssdp:byebye") return;
  const serial = headers.get("usn") || "";
  const model = headers.get("devmodel.bambu.com") || "";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(serial) || !/^[a-zA-Z0-9_. -]{1,64}$/.test(model)) return;
  return { host, serial, model };
}
function finish(scan: Scan, error?: ApiError) {
  if (active !== scan) return;
  active = undefined;
  clearTimeout(scan.timer);
  for (const socket of scan.sockets) {
    try {
      socket.close();
    } catch {}
  }
  for (const listener of scan.listeners) listener(undefined, error);
  scan.listeners.clear();
}
function begin(): Scan {
  const duration = timeout();
  const scan: Scan = {
    sockets: new Set(),
    printers: new Map(),
    listeners: new Set(),
    timer: setTimeout(() => finish(scan), duration),
    packets: 0,
  };
  active = scan;
  let pending = 2;
  const failed = (socket: Socket) => {
    scan.sockets.delete(socket);
    try {
      socket.close();
    } catch {}
    if (!pending && !scan.sockets.size) finish(scan, unavailable());
  };
  for (const port of [2021, 1990]) {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    scan.sockets.add(socket);
    let opening = true;
    socket.on("error", () => {
      if (opening) {
        opening = false;
        pending--;
      }
      failed(socket);
    });
    socket.on("message", (message, remote) => {
      if (active !== scan) return;
      if (++scan.packets > 4096) {
        finish(scan);
        return;
      }
      const printer = announcement(message, remote.address);
      if (!printer || (scan.printers.size >= 128 && !scan.printers.has(printer.serial))) return;
      scan.printers.set(printer.serial, printer);
      for (const listener of [...scan.listeners]) listener(printer);
    });
    socket.on("listening", () => {
      if (active !== scan) {
        socket.close();
        return;
      }
      opening = false;
      pending--;
      let joined = false;
      for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses || []) {
          if (address.internal || address.family !== "IPv4") continue;
          try {
            socket.addMembership(multicast, address.address);
            joined = true;
          } catch {}
        }
      }
      if (!joined) failed(socket);
    });
    queueMicrotask(() => {
      if (active !== scan) return;
      try {
        socket.bind(port, "0.0.0.0");
      } catch {
        opening = false;
        pending--;
        failed(socket);
      }
    });
  }
  return scan;
}
export async function discoverPrinters(serial?: string): Promise<DiscoveredPrinter[]> {
  if (process.env.DISCOVERY_ENABLED === "false")
    return Promise.reject(
      new ApiError(503, "Printer discovery is disabled. Enter the host manually."),
    );
  const scan = active || begin();
  if (scan.listeners.size >= 128)
    return Promise.reject(new ApiError(429, "Too many discovery requests. Try again shortly."));
  const found = serial ? scan.printers.get(serial) : undefined;
  if (found) return Promise.resolve([found]);
  return new Promise((resolve, reject) => {
    const listener = (printer?: DiscoveredPrinter, error?: ApiError) => {
      if (printer && printer.serial !== serial) return;
      scan.listeners.delete(listener);
      if (error) reject(error);
      else resolve(printer ? [printer] : serial ? [] : [...scan.printers.values()]);
      if (!scan.listeners.size) finish(scan);
    };
    scan.listeners.add(listener);
  });
}

export function stopDiscovery() {
  if (active) finish(active, new ApiError(503, "Printer discovery stopped."));
}
