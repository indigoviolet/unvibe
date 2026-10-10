/**
 * Toast (`#toast`, `role=status`): imperative notifications, e.g.
 * `toast("Saved")`. A new toast replaces the current one and restarts the
 * 2.6 s auto-dismiss timer (prototype behaviour).
 */
import { useEffect, useRef, useState } from "react";

let notify: ((msg: string) => void) | null = null;

/** Imperative toast used across the app: `toast("Saved")`. */
export function toast(msg: string): void {
  notify?.(msg);
}

export function Toast(): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    notify = (m: string) => {
      setMsg(m);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), 2600);
    };
    return () => {
      notify = null;
      window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div id="toast" role="status" hidden={msg === null}>
      {msg}
    </div>
  );
}
