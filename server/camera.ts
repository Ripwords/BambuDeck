import { connect, type TLSSocket } from "node:tls";
import { spawn, type ChildProcess } from "node:child_process";

export class CameraError extends Error {
  readonly status = 503;
}

interface CameraProfile {
  host: string;
  code: string;
}
interface CameraInfo {
  model: string;
  rtsp: string;
}
interface Waiter {
  resolve: (frame: Buffer) => void;
  reject: (error: Error) => void;
}

export class CameraFeed {
  private socket: TLSSocket | null = null;
  private process: ChildProcess | null = null;
  private buffer = Buffer.alloc(0);
  private frame: Buffer | null = null;
  private frameTime = 0;
  private retryAfter = 0;
  private waiters = new Set<Waiter>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private epoch = 0;

  constructor(
    private readonly profile: CameraProfile,
    private readonly info: () => CameraInfo,
  ) {}

  async snapshot(signal?: AbortSignal): Promise<Buffer> {
    if (this.closed) throw new CameraError("Camera connection was closed.");
    if (signal?.aborted) throw new CameraError("Camera request cancelled.");
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), 30000);
    if (!this.socket && !this.process && Date.now() >= this.retryAfter)
      this.start();
    if (this.frame && Date.now() - this.frameTime < 5000) return this.frame;
    return new Promise<Buffer>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", aborted);
        this.waiters.delete(waiter);
      };
      const waiter: Waiter = {
        resolve: (frame) => {
          cleanup();
          resolve(frame);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const aborted = () =>
        waiter.reject(new CameraError("Camera request cancelled."));
      const timeout = setTimeout(
        () =>
          waiter.reject(
            new CameraError(
              "Camera unavailable. Check LAN camera access and streaming settings.",
            ),
          ),
        12000,
      );
      this.waiters.add(waiter);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }

  private start() {
    this.buffer = Buffer.alloc(0);
    const current = ++this.epoch;
    const { model, rtsp } = this.info();
    if (
      rtsp ||
      [
        "BL-P001",
        "BL-P002",
        "C13",
        "O1C",
        "O1C2",
        "O1D",
        "O1E",
        "O1S",
        "N6",
        "N7",
      ].includes(model)
    ) {
      let url: URL;
      try {
        url = new URL(
          rtsp ||
            `rtsps://${this.profile.host.includes(":") ? `[${this.profile.host}]` : this.profile.host}:322/streaming/live/1`,
        );
      } catch {
        this.failed(current);
        return;
      }
      if (!["rtsps:", "rtsp:"].includes(url.protocol)) {
        this.failed(current);
        return;
      }
      url.hostname = this.profile.host.includes(":")
        ? `[${this.profile.host}]`
        : this.profile.host;
      url.username = "bblp";
      url.password = this.profile.code;
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-rtsp_transport",
          "tcp",
          "-i",
          url.toString(),
          "-an",
          "-vf",
          "fps=2,scale=1280:-2",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      this.process = child;
      child.stdout?.on("data", (data: Buffer) => {
        if (current === this.epoch) this.accept(data);
      });
      child.once("error", () => this.failed(current));
      child.once("exit", () => this.failed(current));
    } else {
      const socket = connect({
        host: this.profile.host,
        port: 6000,
        rejectUnauthorized: false,
      });
      this.socket = socket;
      socket.setTimeout(10000);
      socket.once("secureConnect", () => {
        if (current !== this.epoch) return;
        const auth = Buffer.alloc(80);
        auth.writeUInt32LE(0x40, 0);
        auth.writeUInt32LE(0x3000, 4);
        auth.write("bblp", 16, 32, "utf8");
        auth.write(this.profile.code, 48, 32, "utf8");
        socket.write(auth);
      });
      socket.on("data", (data) => {
        if (current === this.epoch)
          this.accept(typeof data === "string" ? Buffer.from(data) : data);
      });
      socket.once("error", () => this.failed(current));
      socket.once("close", () => this.failed(current));
      socket.once("timeout", () => this.failed(current));
    }
    this.armWatchdog();
  }

  private accept(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.failed(this.epoch);
      return;
    }
    for (;;) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        this.buffer =
          this.buffer.at(-1) === 0xff
            ? this.buffer.subarray(-1)
            : Buffer.alloc(0);
        return;
      }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        this.buffer = this.buffer.subarray(start);
        return;
      }
      this.frame = Buffer.from(this.buffer.subarray(start, end + 2));
      this.frameTime = Date.now();
      this.buffer = this.buffer.subarray(end + 2);
      this.armWatchdog();
      for (const waiter of [...this.waiters]) waiter.resolve(this.frame);
    }
  }

  private armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    const epoch = this.epoch;
    this.watchdog = setTimeout(() => this.failed(epoch), 15000);
  }
  private failed(epoch: number) {
    if (epoch !== this.epoch) return;
    this.retryAfter = Date.now() + 3000;
    this.stop();
    for (const waiter of [...this.waiters])
      waiter.reject(
        new CameraError(
          "Camera unavailable. Check LAN camera access and streaming settings.",
        ),
      );
  }
  private stop() {
    this.epoch++;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.socket?.destroy();
    this.socket = null;
    this.process?.kill("SIGKILL");
    this.process = null;
    this.buffer = Buffer.alloc(0);
  }
  async close() {
    this.closed = true;
    if (this.idle) clearTimeout(this.idle);
    this.stop();
    this.frame = null;
    for (const waiter of [...this.waiters])
      waiter.reject(new CameraError("Camera connection was closed."));
  }
}
