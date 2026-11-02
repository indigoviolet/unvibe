/**
 * #322 part 2 spike: page capture for the side panel. Reads ONLY on
 * request from the panel (via the worker): current selection, title, URL
 * and a capped window of main text. Never talks to the service, never
 * sends anything on its own — nothing leaves the page until Ask.
 */
(function () {
  "use strict";
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "unvibe:find-quote") {
      const quote = String(msg.quote || "").trim().replace(/\s+/g, " ");
      const text = (document.body ? document.body.innerText : "").replace(/\s+/g, " ");
      const found = quote !== "" && text.includes(quote);
      if (found && window.find) { try { window.find(quote); } catch { /* highlight is best-effort */ } }
      sendResponse({ found });
      return false;
    }
    if (!msg || msg.type !== "unvibe:capture") return false;
    try {
      const selection = String(window.getSelection ? window.getSelection().toString() : "");
      const main = document.querySelector("main") || document.body;
      const context = (main ? main.innerText : "").slice(0, 8000);
      sendResponse({ url: window.location.href, title: document.title, selection: selection.slice(0, 2000), context });
    } catch { sendResponse({ url: window.location.href, title: document.title, selection: "", context: "" }); }
    return false;
  });
})();
