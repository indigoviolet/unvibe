import { useMemo } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";

/** Minimal honest attempt: file paths + search, as our files panel would need. */
export function TreesDemo() {
  const paths = useMemo(
    () => [
      "src/urllib3/connection.py",
      "src/urllib3/response.py",
      "test/test_connection.py",
      "test/with_dummyserver/test_socketlevel.py",
      "changelog/1362.bugfix.rst",
      "docs/guide.md",
    ],
    [],
  );
  let body: React.ReactNode;
  try {
    const { model } = useFileTree({ paths, search: true, initialExpansion: "open", flattenEmptyDirectories: true } as any);
    body = <FileTree model={model} />;
  } catch (e) {
    body = <pre data-trees-error>{String(e).slice(0, 500)}</pre>;
  }
  return (
    <div data-trees-demo="mounted">
      <p>Trees demo — real component below.</p>
      <div id="trees-mount" style={{ height: 400, border: "1px solid #ccc" }}>{body}</div>
    </div>
  );
}
