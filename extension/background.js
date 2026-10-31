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
async function findService() {
  const origins = cachedOrigin
    ? [cachedOrigin, ...candidateOrigins().filter((o) => o !== cachedOrigin)]
    : candidateOrigins();
  let firstHealthy = null;
  for (const origin of origins) {
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

async function prStatus(prUrl) {
  const svc = await findService();
  if (!svc) return { state: "down" };
  if (!svc.token) return { state: "unauthenticated", origin: svc.origin };
  try {
    const res = await fetchWithTimeout(
      `${svc.origin}${PR_STATUS_PATH}?pr=${encodeURIComponent(prUrl)}`,
      { headers: { authorization: `Bearer ${svc.token}` } },
      5000,
    );
    if (res.status === 401 || res.status === 403) {
      return { state: "unauthenticated", origin: svc.origin };
    }
    if (!res.ok) return { state: "error", origin: svc.origin };
    const body = await res.json().catch(() => null);
    if (!body) return { state: "error", origin: svc.origin };
    return {
      state: body.exists ? "exists" : "missing",
      origin: svc.origin,
      reviewId: body.reviewId ?? null,
      status: body.status ?? null,
    };
  } catch {
    return { state: "down" };
  }
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
  const svc = await findService();
  if (!svc) return { ok: false, error: "down" };
  if (!svc.token) return { ok: false, error: "unauthenticated", origin: svc.origin };
  try {
    const res = await fetchWithTimeout(
      `${svc.origin}${OPEN_PATH}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${svc.token}`, "content-type": "application/json" },
        body: JSON.stringify({ pr: prUrl }),
      },
      60000,
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || typeof body.reviewId !== "string" || !body.reviewId) {
      return { ok: false, error: (body && body.error) || `http ${res.status}`, origin: svc.origin };
    }
    await chrome.tabs.create({ url: `${svc.origin}/review/${body.reviewId}` });
    return { ok: true, origin: svc.origin };
  } catch {
    return { ok: false, error: "down" };
  }
}

// ---- #322 part 2: side panel (worker is still the only service caller) ----
const PANEL_PREFIX = "/api/extension/panel";
try { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch { /* older Chrome */ }

async function panelCall(method, path, body) {
  const svc = await findService();
  if (!svc) return { error: "down" };
  if (!svc.token) return { error: "unauthenticated", origin: svc.origin };
  try {
    const res = await fetchWithTimeout(`${svc.origin}${PANEL_PREFIX}${path}`, {
      method,
      headers: { authorization: `Bearer ${svc.token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, 30000);
    const json = await res.json().catch(() => null);
    if (!res.ok) return { error: (json && json.error) || `http ${res.status}`, origin: svc.origin };
    return { ...(json || {}), origin: svc.origin };
  } catch { return { error: "down" }; }
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
