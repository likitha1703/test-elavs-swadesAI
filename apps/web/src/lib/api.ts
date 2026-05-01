const BASE = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

export async function fetchRuns() {
  const res = await fetch(`${BASE}/api/v1/runs`);
  return res.json();
}

export async function fetchRun(id: string) {
  const res = await fetch(`${BASE}/api/v1/runs/${id}`);
  return res.json();
}

export async function fetchCompare(a: string, b: string) {
  const res = await fetch(`${BASE}/api/v1/runs/compare?a=${a}&b=${b}`);
  return res.json();
}

export async function startRun(strategy: string, model: string) {
  const res = await fetch(`${BASE}/api/v1/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy, model }),
  });
  return res.json();
}
