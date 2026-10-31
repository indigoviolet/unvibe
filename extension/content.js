/**
 * Unvibe content script (#322 part 1): adds a "Review in Unvibe" button
 * to GitHub PR pages. It never talks to the service and never sees the
 * token — it asks the background worker whether a review exists and asks
 * it to open the review tab. Fails quietly if GitHub's DOM has moved.
 */
(function () {
  "use strict";
  const BUTTON_ID = "unvibe-review-button";

  function prUrlFromLocation() {
    const m = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);
    if (!m) return null;
    return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
  }

  // One robust anchor (the PR header actions), with fallbacks that still
  // land the button in the PR header. Returns null to fail quietly.
  function findAnchor() {
    const actions = document.querySelector(".gh-header-actions");
    if (actions) return { el: actions, mode: "append" };
    const meta = document.querySelector(".gh-header-meta");
    if (meta) return { el: meta, mode: "append" };
    const show = document.querySelector(".gh-header-show");
    if (show) return { el: show, mode: "append" };
    const header = document.querySelector(".gh-header");
    if (header) return { el: header, mode: "append" };
    return null;
  }

  function setState(btn, state) {
    btn.dataset.state = state;
    if (state === "exists") {
      btn.textContent = "Open review";
      btn.title = "Open this PR's review in Unvibe";
    } else if (state === "down") {
      btn.textContent = "Start Unvibe";
      btn.title = "Unvibe isn't running — run: unvibe open";
    } else {
      btn.textContent = "Review in Unvibe";
      btn.title = "Review this PR in Unvibe";
    }
  }

  function ensureButton() {
    try {
      const prUrl = prUrlFromLocation();
      if (!prUrl) return;
      let btn = document.getElementById(BUTTON_ID);
      if (!btn) {
        const anchor = findAnchor();
        if (!anchor) return;
        btn = document.createElement("button");
        btn.id = BUTTON_ID;
        btn.type = "button";
        btn.className = "unvibe-review-btn";
        setState(btn, "missing");
        btn.addEventListener("click", () => {
          if (btn.dataset.state === "down") {
            const old = btn.textContent;
            btn.textContent = "Run: unvibe open";
            setTimeout(() => setState(btn, "down"), 2000);
            void old;
            return;
          }
          try {
            chrome.runtime.sendMessage({ type: "unvibe:open", prUrl }, () => {
              void chrome.runtime.lastError;
            });
          } catch {
            // Worker gone (extension reloaded): fail quietly.
          }
        });
        anchor.el.appendChild(btn);
      }
      btn.dataset.prUrl = prUrl;
      try {
        chrome.runtime.sendMessage({ type: "unvibe:pr-status", prUrl }, (res) => {
          if (chrome.runtime.lastError || !res) return;
          // The page may have navigated (Turbo) while asking.
          if (btn.dataset.prUrl !== prUrlFromLocation()) return;
          setState(btn, res.state === "exists" ? "exists" : res.state === "down" ? "down" : "missing");
        });
      } catch {
        // Worker unavailable: leave the default label; the click still
        // asks the worker to open the deep link.
      }
    } catch {
      // GitHub's DOM changed: no button, no broken layout.
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureButton();
    }, 250);
  }

  ensureButton();
  // GitHub navigates with Turbo: re-run as the header is replaced.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
