/* #322 part 2 spike panel: one thread per page. Talks ONLY to the worker. */
"use strict";
const $ = (id) => document.getElementById(id);
let capture = { url: "", title: "", selection: "", context: "" };

function send(msg) { return new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(r || { error: "no worker" })); } catch { res({ error: "no worker" }); } }); }
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function renderThread(thread) {
  const el = $("thread");
  if (!thread || !thread.messages || thread.messages.length === 0) {
    el.innerHTML = '<p class="muted">One thread for this page. Ask below — nothing is sent until you do.</p>';
    return;
  }
  el.innerHTML = thread.messages.map((m) => {
    const repos = (m.reposUsed || []).map((r) => `<span class="chip">${esc(r)}</span>`).join("");
    const cites = (m.citations || []).map((c) => `<span class="cite" title="${esc(c)}">&lt;&gt; ${esc(c)}</span>`).join("");
    return `<div class="msg"><div class="role">${m.role === "user" ? "You" : "Unvibe"}</div>${esc(m.text)}<div>${repos}</div><div>${cites}</div></div>`;
  }).join("");
}

async function refresh() {
  capture = await send({ type: "unvibe:panel-capture" });
  // Standalone/test fallback: panel.html?url=<github page>&selection=…
  if (!capture.url || !capture.url.startsWith("https://github.com/")) {
    const q = new URLSearchParams(window.location.search);
    if (q.get("url")) capture = { url: q.get("url"), title: q.get("title") || "", selection: q.get("selection") || "", context: q.get("context") || "" };
  }
  $("page-title").textContent = capture.title || "No GitHub page captured yet";
  $("page-url").textContent = capture.url || "";
  const sel = $("selection-box");
  if (capture.selection) { sel.hidden = false; sel.textContent = `Selected: ${capture.selection}`; } else sel.hidden = true;
  const repos = await send({ type: "unvibe:panel-active-repos" });
  $("repos").innerHTML = repos.error
    ? `<span class="muted">Service ${esc(repos.error)} — run: unvibe open</span>`
    : (repos.repos || []).filter((r) => r.active).map((r) => `<span class="chip">${esc(r.owner)}/${esc(r.name)}</span>`).join("") || '<span class="muted">No active repos</span>';
  if (capture.url) {
    const t = await send({ type: "unvibe:panel-thread", url: capture.url });
    if (!t.error) renderThread(t);
  }
}

$("refresh").addEventListener("click", () => void refresh());
$("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("question").value.trim();
  if (!question) return;
  $("status").textContent = "Reading active repos…";
  $("ask").disabled = true;
  const r = await send({ type: "unvibe:panel-ask", body: { ...capture, question } });
  $("ask").disabled = false;
  if (r.error) { $("status").textContent = `Could not ask: ${r.error}`; return; }
  $("status").textContent = r.reposUsed && r.reposUsed.length ? `Used: ${r.reposUsed.join(", ")} · ~${r.tokensEstimate} tokens in` : "No repo matched";
  $("question").value = "";
  renderThread(r.thread);
});
void refresh();
