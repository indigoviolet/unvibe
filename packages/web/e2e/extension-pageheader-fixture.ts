/**
 * Issue #410: a hand-built page in the shape of GitHub's new PR Overview
 * layout (URL `?overview=true`, tabs Overview / Commits / Checks /
 * Files changed). Structure only: a Primer-style PageHeader with its
 * `data-component` parts, plus the sticky mini-header the button must
 * NOT use. Class names and styling are our own; nothing is copied from
 * a real page.
 */

export const PAGEHEADER_TABS = ["Overview", "Commits", "Checks", "Files changed"] as const;
export type PageHeaderTab = (typeof PAGEHEADER_TABS)[number];

export const PAGEHEADER_STYLE = `body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;margin:0;color:#1f2328;background:#fff}
.ph{padding:16px 24px 0;border-bottom:1px solid #d1d9e0}
.ph-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ph-title h1{font-size:28px;font-weight:400;margin:0}
.ph-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.ph-actions button{font:inherit;font-size:12px;font-weight:500;height:28px;padding:0 12px;border-radius:6px;border:1px solid rgba(31,35,40,.15);background:#f6f8fa;color:#1f2328;cursor:pointer}
.ph-desc{color:#59636e;margin-top:8px;display:flex;gap:8px;align-items:center}
.ph-state{background:#1f883d;color:#fff;border-radius:999px;padding:2px 10px;font-size:12px}
.ph-nav{display:flex;gap:16px;margin-top:16px}
.ph-nav a{padding:8px 0;color:#59636e;text-decoration:none;border-bottom:2px solid transparent}
.ph-nav a[aria-current="page"]{color:#1f2328;border-color:#fd8c73;font-weight:600}
.ph-sticky{display:flex;gap:8px;justify-content:flex-end;padding:8px 24px;border-bottom:1px solid #d1d9e0}
.ph-sticky button{font:inherit;font-size:12px;height:28px;padding:0 12px;border-radius:6px;border:1px solid rgba(31,35,40,.15);background:#f6f8fa}
@media (prefers-color-scheme: dark){
body{background:#0d1117;color:#e6edf3}
.ph,.ph-sticky{border-color:#30363d}
.ph-actions button,.ph-sticky button{background:#21262d;color:#e6edf3;border-color:rgba(240,246,252,.1)}
.ph-desc,.ph-nav a{color:#9198a1}
.ph-nav a[aria-current="page"]{color:#e6edf3}
}`;

/** The page body with `tab` selected; a tab switch re-renders all of it. */
export function pageHeaderBody(prNumber: number, tab: PageHeaderTab = "Overview"): string {
  const nav = PAGEHEADER_TABS.map(
    (t) => `<a href="#"${t === tab ? ' aria-current="page"' : ""}>${t}</a>`,
  ).join("");
  return `<div data-component="PageHeader" class="ph">
  <div class="ph-row">
    <div data-component="TitleArea" class="ph-title"><h1>Fix the thing <span>#${prNumber}</span></h1></div>
    <div data-component="PH_Actions" class="ph-actions"><button type="button">Preview</button> <button type="button">Code</button> <button type="button" aria-label="Subscribe">Subscribe</button></div>
  </div>
  <div data-component="PageHeader.Description" class="ph-desc"><span class="ph-state">Open</span> <strong>author</strong> wants to merge 1 commit into <code>main</code> from <code>feature</code> <span>+12 −3</span></div>
  <nav data-component="PH_Navigation" class="ph-nav" aria-label="Pull request tabs">${nav}</nav>
</div>
<div data-testid="diff-comparison-viewer-sticky-header-bar" class="ph-sticky"><button type="button">Merge status</button> <button type="button">Submit review</button></div>
<main><p>${tab} tab. Fixture PR body. Served locally; github.com is routed here.</p></main>`;
}

export function pageHeaderFixtureHtml(owner: string, name: string, prNumber: number): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fix the thing · Pull Request #${prNumber} · ${owner}/${name}</title>
<style>${PAGEHEADER_STYLE}</style></head>
<body>
${pageHeaderBody(prNumber)}
</body></html>`;
}
