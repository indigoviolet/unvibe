/*global document localStorage */
/* UI theme boot (issue #196): external file so the app shell can serve a
 * strict CSP without `unsafe-inline` for scripts. Loaded synchronously
 * from <head>, before the app bundle and before first paint, so a saved
 * theme never flashes the default. The server-side setting (Settings ->
 * Appearance, PUT /api/settings) is the source of truth; this reads its
 * localStorage mirror (`unvibe:ui-theme`, kept in step by
 * src/theme/theme.ts) because settings cannot be fetched before paint.
 * Light/dark is a separate axis and is not touched here. */
(function () {
  var theme = "default";
  try {
    var saved = localStorage.getItem("unvibe:ui-theme");
    if (saved === "default" || saved === "midnight") theme = saved;
  } catch {
    /* storage unavailable: the default theme stands */
  }
  document.documentElement.setAttribute("data-ui-theme", theme);
})();
