/**
 * Unvibe content script (#322 part 1, #333): adds a "Review in Unvibe"
 * button to every GitHub PR tab, including the Conversation header.
 * It never talks to the service and never sees the
 * token — it asks the background worker whether a review exists and asks
 * it to start (or open) the review; the worker calls the service itself
 * and opens the review tab. Fails quietly if GitHub's DOM has moved.
 */
(function () {
  "use strict";
  const BUTTON_ID = "unvibe-review-button";

  function prUrlFromLocation() {
    const m = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);
    if (!m) return null;
    return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
  }

  // Overlay subtrees the button must never land in (#392). A candidate
  // with one of these ancestors is rejected, so dialogs, popovers and
  // overlays (e.g. the "Finish your review" dialog) can never become
  // the anchor when they open or re-render.
  const OVERLAY_SELECTORS = [
    '[role="dialog"]',
    "dialog",
    "[popover]",
    ".Popover",
    ".Overlay",
    "[data-overlay]",
    "details-dialog",
  ];

  function isInOverlay(el) {
    if (!el || !el.closest) return false;
    for (const sel of OVERLAY_SELECTORS) {
      let hit = null;
      try {
        hit = el.closest(sel);
      } catch {
        hit = null;
      }
      if (hit) return true;
    }
    return false;
  }

  // Anchors ONLY in the PR page header (#392). The code/files tabs keep
  // the classic `.gh-header-*` hooks; the Conversation header (title with
  // the Merge status / Code buttons beside it) doesn't use those, so it
  // is found through its actions container's `data-testid` — a stable
  // React hook that survives button-text and class churn, unlike the
  // removed structural fallbacks. These hooks ARE the rendered-PR-page
  // recognition: they are specific to the PR page header, so other pages
  // served under PR URLs (e.g. the SSO re-authentication screen, with
  // headings but no header hook) match nothing. A URL match alone is
  // never enough. Returns null to fail quietly when no header hook
  // matches; the broad fallbacks (first "Code" button's group, first
  // `h1`'s container) are gone, so dialogs and overlays with headings or
  // matching buttons can never become the anchor.
  function findAnchor() {
    // Each hook is a specific sub-container of the PR page header —
    // never the bare outer header alone. The Conversation header has no
    // `.gh-header-*` hooks at all, hence the single `data-testid` hook.
    const selectors = [
      ".gh-header-actions",
      ".gh-header-meta",
      ".gh-header-show",
      // Current Conversation header (#333).
      '[data-testid="pr-conversation-header-actions"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !isInOverlay(el)) return { el, mode: "append" };
    }
    return null;
  }

  // The Unvibe "u" mark (site/favicon.svg, issue #299): indigo u on a
  // pink square, inlined so the content script stays dependency-free.
  function makeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 64 64");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "unvibe-review-icon");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "64");
    rect.setAttribute("height", "64");
    rect.setAttribute("fill", "#FF09B7");
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mark.setAttribute(
      "d",
      "M9.39 16.13V42.18L19.25 52.11H45.33L54.95 42.21V16.13H42.64V39.97H21.73V16.13Z",
    );
    mark.setAttribute("fill", "#38309E");
    svg.appendChild(rect);
    svg.appendChild(mark);
    return svg;
  }

  function labelEl(btn) {
    return btn.querySelector(".unvibe-review-label") || btn;
  }

  function setState(btn, state) {
    btn.dataset.state = state;
    const label = labelEl(btn);
    if (state === "exists") {
      label.textContent = "Open review";
      btn.title = "Open this PR's review in Unvibe";
    } else if (state === "down") {
      label.textContent = "Start Unvibe";
      btn.title = "Unvibe isn't running — run: unvibe open";
    } else {
      label.textContent = "Review in Unvibe";
      btn.title = "Review this PR in Unvibe";
    }
  }

  function ensureButton() {
    try {
      const prUrl = prUrlFromLocation();
      if (!prUrl) return;
      // Turbo/React re-renders may clone the header: never keep two.
      const copies = document.querySelectorAll(`#${BUTTON_ID}`);
      for (let i = 1; i < copies.length; i++) copies[i].remove();
      let btn = document.getElementById(BUTTON_ID);
      // A button inside an overlay was never valid there (#392): drop
      // it instead of leaving it in the dialog.
      if (btn && isInOverlay(btn)) {
        btn.remove();
        btn = null;
      }
      const anchor = findAnchor();
      if (!btn) {
        if (!anchor) return;
        btn = document.createElement("button");
        btn.id = BUTTON_ID;
        btn.type = "button";
        btn.className = "unvibe-review-btn";
        btn.appendChild(makeIcon());
        const label = document.createElement("span");
        label.className = "unvibe-review-label";
        btn.appendChild(label);
        setState(btn, "missing");
        btn.addEventListener("click", () => {
          if (btn.dataset.state === "down") {
            const labelNow = labelEl(btn);
            labelNow.textContent = "Run: unvibe open";
            setTimeout(() => setState(btn, "down"), 2000);
            return;
          }
          try {
            chrome.runtime.sendMessage({ type: "unvibe:open", prUrl }, (res) => {
              void chrome.runtime.lastError;
              // #335: the worker opens the review itself; a failure shows
              // an honest state on the button, never a blank tab.
              if (res && res.ok === false) {
                const labelNow = labelEl(btn);
                labelNow.textContent = "Couldn't start review";
                btn.title =
                  res.error === "unauthenticated"
                    ? "Unvibe isn't connected in this browser — run: unvibe open"
                    : res.error === "down"
                      ? "Unvibe isn't running — run: unvibe open"
                      : `Unvibe couldn't start the review: ${res.error}`;
                setTimeout(() => setState(btn, btn.dataset.state || "missing"), 4000);
              }
            });
          } catch {
            // Worker gone (extension reloaded): fail quietly.
          }
        });
        anchor.el.appendChild(btn);
      } else if (anchor && !anchor.el.contains(btn)) {
        // Client-side navigation swapped the header (Turbo/React):
        // adopt the new anchor instead of duplicating. The anchor is
        // never inside an overlay (findAnchor rejects those), and when
        // there is no anchor the button is left where it is — the
        // observer must never move it into a newly opened overlay (#392).
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
