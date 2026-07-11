export interface YoutubeStats {
  subscriberCount: number | null;
  viewCount: number;
  videoCount: number;
}

const POLL_INTERVAL = 5 * 60 * 1000;

export function watchYoutubeStats(onUpdate: (stats: YoutubeStats) => void): () => void {
  let cancelled = false;

  async function poll() {
    try {
      const res = await fetch("/api/youtube");
      if (!res.ok) return;
      const stats = (await res.json()) as YoutubeStats;
      if (!cancelled) onUpdate(stats);
    } catch {
      // keep last known value on transient failure
    }
  }

  void poll();
  const timer = window.setInterval(poll, POLL_INTERVAL);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}
