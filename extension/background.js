/**
 * Unvibe extension background worker (#322 part 1).
 *
 * Only this worker talks to the local Unvibe service. It reads the
 * service's `__unvibe_token` cookie (set by the web app on the service
 * origin) with `chrome.cookies` and sends it as a Bearer token to the
 * service — never to github.com or anywhere else. Content scripts only
 * ever message this worker; they hold no token and make no requests.
 *
 * Keep the constants in sync with `packages/shared/src/extension.ts`.
 */
const TOKEN_COOKIE = "__unvibe_token";
const PR_STATUS_PATH = "/api/extension/pr-status";
const OPEN_PATH = "/api/extension/open";

// The service normally listens on 4517 (UNVIBE_PORT). A few following
// ports are probed too so a service moved one port over still works.
const CANDIDATE_PORTS = [4517, 4518, 4519, 4520, 4521];
const CANDIDATE_HOSTS = ["unvibe.localhost", "127.0.0.1"];

let cachedOrigin = null;

function candidateOrigins() {
  const out = [];
  for (const port of CANDIDATE_PORTS) {
    for (const host of CANDIDATE_HOSTS) out.push(`http://${host}:${port}`);
  }
  return out;
}

async function fetchWithTimeout(url, options = {}, ms = 900) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tokenFor(origin) {
  try {
    const cookie = await chrome.cookies.get({ url: origin, name: TOKEN_COOKIE });
    return cookie && cookie.value ? cookie.value : null;
  } catch {
    return null;
  }
}

/** Find the running service: first healthy origin, preferring one with a token cookie. */
async function findService(exclude) {
  const origins = cachedOrigin
    ? [cachedOrigin, ...candidateOrigins().filter((o) => o !== cachedOrigin)]
    : candidateOrigins();
  let firstHealthy = null;
  for (const origin of origins) {
    // An origin that just rejected the token is a different same-host
    // service, not ours — skip it this round (see withService).
    if (exclude && exclude.has(origin)) continue;
    try {
      const res = await fetchWithTimeout(`${origin}/api/health`);
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      if (!body || body.ok !== true) continue;
    } catch {
      continue;
    }
    const token = await tokenFor(origin);
    if (token) {
      cachedOrigin = origin;
      return { origin, token };
    }
    if (!firstHealthy) firstHealthy = { origin, token: null };
  }
  if (firstHealthy) cachedOrigin = firstHealthy.origin;
  return firstHealthy;
}

/**
 * Resolve one authenticated service call.
 *
 * v0.0.14 gate: the token cookie is host-scoped (cookies ignore ports),
 * so with several same-host services up every candidate origin "has a
 * token" and discovery can pick one that rejects it (401/403). A
 * rejection therefore drops that origin and tries one other
 * token-carrying origin instead of failing.
 *
 * CI follow-up: a lone service is never discarded — when no alternative
 * exists its rejection is reported honestly (never "down"), a blank
 * discovery falls back to the last-known origin once (slow health checks
 * under load must not read as "down"), and a missing token re-reads the
 * last-known origin once (cookie race) before reporting unauthenticated.
 * Once a rejection has been seen, later rounds never downgrade it to
 * "down" or "unauthenticated".
 *
 * fn(svc) performs the fetch and returns { status, json }; it lets
 * network errors throw (read as "down", with one rediscovery past it).
 */
async function withService(fn) {
  const tried = new Set();
  let rejected = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let svc = await findService(tried);
    if (!svc && !rejected && cachedOrigin && !tried.has(cachedOrigin)) {
      const token = await tokenFor(cachedOrigin);
      if (token) svc = { origin: cachedOrigin, token };
    }
    if (!svc) return rejected ?? { outcome: "down" };
    let target = svc;
    if (!target.token && !rejected && cachedOrigin && !tried.has(cachedOrigin)) {
      const token = await tokenFor(cachedOrigin);
      if (token) target = { origin: cachedOrigin, token };
    }
    if (!target.token) return rejected ?? { outcome: "unauthenticated", origin: target.origin };
    tried.add(target.origin);
    let r;
    try {
      r = await fn(target);
    } catch {
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      rejected = { outcome: "rejected", origin: target.origin, status: r.status, json: r.json };
      if (cachedOrigin === target.origin) cachedOrigin = null;
      continue;
    }
    return { outcome: "answer", svc: target, status: r.status, json: r.json };
  }
  return rejected ?? { outcome: "down" };
}

async function prStatus(prUrl) {
  const out = await withService(async (svc) => {
    const res = await fetchWithTimeout(
      `${svc.origin}${PR_STATUS_PATH}?pr=${encodeURIComponent(prUrl)}`,
      { headers: { authorization: `Bearer ${svc.token}` } },
      5000,
    );
    return { status: res.status, json: await res.json().catch(() => null) };
  });
  if (out.outcome === "answer") {
    if (out.status < 200 || out.status >= 300 || !out.json) return { state: "error", origin: out.svc.origin };
    const body = out.json;
    return {
      state: body.exists ? "exists" : "missing",
      origin: out.svc.origin,
      reviewId: body.reviewId ?? null,
      status: body.status ?? null,
    };
  }
  // A rejection here reads as unauthenticated (the button's sign-in state).
  if (out.outcome === "unauthenticated" || out.outcome === "rejected") {
    return { state: "unauthenticated", origin: out.outcome === "unauthenticated" ? out.origin : out.svc.origin };
  }
  return { state: "down" };
}

/**
 * #335: the button never uses `/open`. The worker calls the
 * authenticated create-or-open endpoint itself (Bearer token, allowlisted
 * extension origin, like the other worker calls) and opens the review
 * directly — no confirmation step. A failure answers `{ ok: false }` so
 * the content script can show an honest state on the button instead of
 * a blank tab; nothing is opened then.
 */
async function openReview(prUrl) {
  const out = await withService(async (svc) => {
    const res = await fetchWithTimeout(
      `${svc.origin}${OPEN_PATH}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${svc.token}`, "content-type": "application/json" },
        body: JSON.stringify({ pr: prUrl }),
      },
      60000,
    );
    return { status: res.status, json: await res.json().catch(() => null) };
  });
  if (out.outcome === "answer") {
    const body = out.json;
    const ok = out.status >= 200 && out.status < 300;
    if (!ok || !body || typeof body.reviewId !== "string" || !body.reviewId) {
      return { ok: false, error: (body && body.error) || `http ${out.status}`, origin: out.svc.origin };
    }
    await chrome.tabs.create({ url: `${out.svc.origin}/review/${body.reviewId}` });
    return { ok: true, origin: out.svc.origin };
  }
  // A lone service's rejection is reported honestly (never "down").
  if (out.outcome === "rejected") {
    const body = out.json;
    return { ok: false, error: (body && body.error) || `http ${out.status}`, origin: out.origin };
  }
  if (out.outcome === "unauthenticated") return { ok: false, error: "unauthenticated", origin: out.origin };
  return { ok: false, error: "down" };
}

// ---- #322 part 2: side panel (worker is still the only service caller) ----
const PANEL_PREFIX = "/api/extension/panel";
try { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch { /* older Chrome */ }

async function panelCall(method, path, body) {
  const out = await withService(async (svc) => {
    const res = await fetchWithTimeout(`${svc.origin}${PANEL_PREFIX}${path}`, {
      method,
      headers: { authorization: `Bearer ${svc.token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, 30000);
    return { status: res.status, json: await res.json().catch(() => null) };
  });
  if (out.outcome === "answer") {
    const ok = out.status >= 200 && out.status < 300;
    if (!ok) return { error: (out.json && out.json.error) || `http ${out.status}`, origin: out.svc.origin };
    return { ...(out.json || {}), origin: out.svc.origin };
  }
  // A lone service's rejection is reported honestly (never "down").
  if (out.outcome === "rejected") {
    return { error: (out.json && out.json.error) || `http ${out.status}`, origin: out.origin };
  }
  if (out.outcome === "unauthenticated") return { error: "unauthenticated", origin: out.origin };
  return { error: "down" };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}
async function captureActiveTab() {
  const tab = await activeTab();
  if (!tab || !tab.id) return { url: "", title: "", selection: "", context: "" };
  try { return await chrome.tabs.sendMessage(tab.id, { type: "unvibe:capture" }); }
  catch { return { url: tab.url || "", title: tab.title || "", selection: "", context: "" }; }
}
async function findQuoteOnPage(quote) {
  const tab = await activeTab();
  if (!tab || !tab.id) return { found: false };
  try { return await chrome.tabs.sendMessage(tab.id, { type: "unvibe:find-quote", quote }); }
  catch { return { found: false }; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && typeof msg.type === "string" && msg.type.startsWith("unvibe:panel")) {
    if (msg.type === "unvibe:panel-capture") { void captureActiveTab().then(sendResponse, () => sendResponse({ url: "", title: "", selection: "", context: "" })); return true; }
    if (msg.type === "unvibe:panel-active-repos") { void panelCall("GET", "/active-repos").then(sendResponse, () => sendResponse({ error: "down" })); return true; }
    if (msg.type === "unvibe:panel-thread") { void panelCall("GET", `/thread?url=${encodeURIComponent(msg.url || "")}`).then(sendResponse, () => sendResponse({ error: "down" })); return true; }
    if (msg.type === "unvibe:panel-ask") { void panelCall("POST", "/ask", msg.body || {}).then(sendResponse, () => sendResponse({ error: "down" })); return true; }
    if (msg.type === "unvibe:panel-find-quote") { void findQuoteOnPage(msg.quote || "").then(sendResponse, () => sendResponse({ found: false })); return true; }
    return false;
  }
  if (!msg || typeof msg.prUrl !== "string") return false;
  if (msg.type === "unvibe:pr-status") {
    void prStatus(msg.prUrl).then(sendResponse, () => sendResponse({ state: "error" }));
    return true;
  }
  if (msg.type === "unvibe:open") {
    void openReview(msg.prUrl).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
