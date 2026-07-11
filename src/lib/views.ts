export async function fetchViewCount(): Promise<number | null> {
  try {
    const res = await fetch("/api/views");
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.count === "number" ? json.count : null;
  } catch {
    return null;
  }
}
