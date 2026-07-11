export interface SpotifyNowPlaying {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  albumArt?: string | null;
  url?: string | null;
}

const POLL_INTERVAL = 15_000;

export function watchNowPlaying(onUpdate: (data: SpotifyNowPlaying) => void): () => void {
  let cancelled = false;

  async function poll() {
    try {
      const res = await fetch("/api/spotify/now-playing");
      if (!res.ok) return;
      const data = (await res.json()) as SpotifyNowPlaying;
      if (!cancelled) onUpdate(data);
    } catch {
      // keep last known state on transient failure
    }
  }

  void poll();
  const timer = window.setInterval(poll, POLL_INTERVAL);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}
