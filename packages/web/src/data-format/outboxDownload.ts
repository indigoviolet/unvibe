/** Save Outbox Markdown as `unvibe-outbox.md` (#311: export before a reset or a format-changing update). */
export function downloadOutboxMarkdown(markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "unvibe-outbox.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
