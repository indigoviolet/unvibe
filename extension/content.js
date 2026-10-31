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

  // Anchors for every PR tab. The code/files tabs keep the classic
  // `.gh-header-*` hooks; the Conversation header (title with the Merge
  // status / Code buttons beside it) doesn't use those, so it is found
  // through stable hooks first (a data attribute, then an ARIA group)
  // and through structure near the PR title as a last resort (the
  // "Code" button's group, then the title's container). Returns null
  // to fail quietly when nothing matches.
  function findAnchor() {
    const actions = document.querySelector(".gh-header-actions");
    if (actions) return { el: actions, mode: "append" };
    const meta = document.querySelector(".gh-header-meta");
    if (meta) return { el: meta, mode: "append" };
    const show = document.querySelector(".gh-header-show");
    if (show) return { el: show, mode: "append" };
    const header = document.querySelector(".gh-header");
    if (header) return { el: header, mode: "append" };
    // Current Conversation header (#333).
    const byTestId = document.querySelector(
      '[data-testid="pr-conversation-header-actions"], [data-testid="pr-header-actions"]',
    );
    if (byTestId) return { el: byTestId, mode: "append" };
    const byAria = document.querySelector(
      '[aria-label="Pull request header actions"], [aria-label="PR header actions"]',
    );
    if (byAria) return { el: byAria, mode: "append" };
    const buttons = Array.from(document.querySelectorAll("button"));
    const codeBtn = buttons.find((b) => (b.textContent || "").trim() === "Code");
    if (codeBtn) {
      const group = codeBtn.closest('[role="group"], div');
      if (group) return { el: group, mode: "append" };
    }
    const title = document.querySelector("h1");
    if (title) {
      const container = title.closest("header, div, section");
      if (container) return { el: container, mode: "append" };
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
        // adopt the new anchor instead of duplicating.
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
