/** Toast slot. Owner: floating agent. */
import { useEffect, useState } from "react";

let notify: ((msg: string) => void) | null = null;

/** Imperative toast used by later agents: `toast("Saved")`. */
export function toast(msg: string): void {
  notify?.(msg);
}

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    notify = (m: string) => {
      setMsg(m);
      const t = setTimeout(() => setMsg(null), 2600);
      return () => clearTimeout(t);
    };
    return () => {
      notify = null;
    };
  }, []);
  return (
    <div id="toast" role="status" hidden={msg === null}>
      {msg}
    </div>
  );
}
