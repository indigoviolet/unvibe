/*global window document localStorage fetch setTimeout URLSearchParams */
/* Unvibe offline page poller (PRD §14): external file so the offline page
 * can serve a strict CSP without `unsafe-inline` for scripts.
 *
 * Keeps a token arriving on our own URL (?token=…) the same way the app
 * does, polls /api/health until the service answers, then reloads the app.
 * Same-origin fetch only (connect-src 'self').
 */
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("token");
    if (fromUrl) {
      localStorage.setItem("unvibe_token", fromUrl);
      document.cookie = "__unvibe_token=" + encodeURIComponent(fromUrl) + "; SameSite=Lax; path=/";
      params.delete("token");
      var rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : ""));
    }
    if (!localStorage.getItem("unvibe_token")) {
      document.getElementById("notoken").hidden = false;
    }
  } catch {
    /* storage unavailable: polling still works */
  }
  var status = document.getElementById("status");
  function poll() {
    fetch("/api/health", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("down");
        status.textContent = "Opening Unvibe…";
        window.location.href = "/";
      })
      .catch(function () {
        status.textContent =
          "Waiting for the service… If nothing happens, click Start Unvibe.";
        setTimeout(poll, 2000);
      });
  }
  poll();
})();
