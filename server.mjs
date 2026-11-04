import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pullTenders, writeTenders } from "./sync.mjs";
import { hasModelAccess, runAgent } from "./agent.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "docs");
const INTERVAL_MS = 6 * 60 * 60 * 1000;

const state = {
  syncing: false,
  error: null,
  fetched: 0,
  totalAvailable: 0,
};

const agent = { running: false, error: null, steps: [], startedAt: null };

async function startAgent({ fresh = false } = {}) {
  if (agent.running) return;
  agent.running = true;
  agent.error = null;
  agent.steps = [];
  agent.startedAt = new Date().toISOString();
  try {
    const run = await runAgent({ fresh, onStep: (step) => agent.steps.push(step) });
    console.log(`agent (${run.mode}): ${run.assessments.length} assessed, ${run.alerts.length} alert(s)`);
  } catch (error) {
    agent.error = error instanceof Error ? error.message : "Agent run failed";
    console.error(agent.error);
  } finally {
    agent.running = false;
  }
}

async function sync() {
  if (state.syncing) return;
  state.syncing = true;
  state.error = null;
  try {
    const payload = await pullTenders((progress) => {
      state.fetched = progress.fetched;
      state.totalAvailable = progress.totalAvailable;
    });
    await writeTenders(payload);
    state.syncing = false;
    state.error = null;
    console.log(`synced ${payload.count} open tenders`);
    startAgent();
  } catch (error) {
    state.syncing = false;
    state.error = error instanceof Error ? error.message : "تعذر سحب المناقصات";
    console.error(state.error);
  }
}

const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/guardian.html": "guardian.html",
  "/icv.html": "icv.html",
  "/agent.html": "agent.html",
  "/agent-run.json": "agent-run.json",
  "/site.css": "site.css",
  "/tenders.json": "tenders.json",
  "/company.json": "company.json",
};

function contentType(pathname) {
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/sync" && request.method === "POST") {
    sync();
    response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ started: true, syncing: true }));
    return;
  }
  if (url.pathname === "/api/status") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(state));
    return;
  }
  if (url.pathname === "/api/agent/run" && request.method === "POST") {
    const fresh = url.searchParams.get("fresh") === "1";
    const already = agent.running;
    startAgent({ fresh });
    response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ started: !already, running: true }));
    return;
  }
  if (url.pathname === "/api/agent/status") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ ...agent, mode: hasModelAccess() ? "claude" : "demo" }));
    return;
  }
  const fileName = files[url.pathname];
  if (!fileName) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  try {
    const body = await readFile(join(publicDir, fileName));
    response.writeHead(200, { "content-type": contentType(fileName), "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(4173, "127.0.0.1", () => {
  console.log("Majan AI tenders on http://127.0.0.1:4173");
});

function schedule() {
  setTimeout(async () => {
    await sync();
    schedule();
  }, INTERVAL_MS);
}

schedule();
