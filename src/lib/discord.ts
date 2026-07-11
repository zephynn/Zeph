export interface LanyardActivity {
  id: string;
  name: string;
  type: number;
  state?: string;
  details?: string;
  application_id?: string;
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
}

export interface LanyardData {
  discord_user: {
    id: string;
    username: string;
    global_name?: string | null;
    discriminator: string;
    avatar: string | null;
  };
  discord_status: "online" | "idle" | "dnd" | "offline";
  activities: LanyardActivity[];
  active_on_discord_mobile: boolean;
  active_on_discord_desktop: boolean;
  active_on_discord_web: boolean;
}

type Listener = (data: LanyardData) => void;

const SOCKET_URL = "wss://api.lanyard.rest/socket";
const REST_URL = (id: string) => `https://api.lanyard.rest/v1/users/${id}`;

/**
 * Lanyard exposes presence over a subscribe-based WebSocket (op 1 HELLO -> op 2
 * INIT_STATE with subscribe_to_id -> heartbeats). REST is used only as the
 * first-paint fallback if the socket hasn't connected yet or fails outright.
 */
export class LanyardClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private reconnectDelay = 1000;
  private listeners = new Set<Listener>();
  private closedByUser = false;

  constructor(private userId: string) {}

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start() {
    this.closedByUser = false;
    void this.fetchInitialRest();
    this.connect();
  }

  stop() {
    this.closedByUser = true;
    window.clearInterval(this.heartbeatTimer);
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private async fetchInitialRest() {
    try {
      const res = await fetch(REST_URL(this.userId));
      if (!res.ok) return;
      const json = await res.json();
      if (json?.success && json.data) this.emit(json.data);
    } catch {
      // socket will take over; ignore
    }
  }

  private connect() {
    this.ws = new WebSocket(SOCKET_URL);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.op) {
        case 1: {
          const interval = msg.d.heartbeat_interval as number;
          this.ws?.send(JSON.stringify({ op: 2, d: { subscribe_to_id: this.userId } }));
          window.clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = window.setInterval(() => {
            this.ws?.send(JSON.stringify({ op: 3 }));
          }, interval);
          break;
        }
        case 0: {
          if (msg.t === "INIT_STATE" || msg.t === "PRESENCE_UPDATE") {
            this.emit(msg.d as LanyardData);
          }
          break;
        }
      }
    };

    this.ws.onclose = () => {
      if (this.closedByUser) return;
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    };

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };
  }

  private emit(data: LanyardData) {
    for (const listener of this.listeners) listener(data);
  }
}

export function discordAvatarUrl(user: LanyardData["discord_user"], size = 128): string {
  if (!user.avatar) {
    const fallbackIndex = Number(BigInt(user.id) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
  }
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
}

export const STATUS_LABEL: Record<LanyardData["discord_status"], string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};
