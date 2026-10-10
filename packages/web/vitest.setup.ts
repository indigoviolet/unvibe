import "@testing-library/jest-dom/vitest";

// vitest's jsdom integration does not always propagate `localStorage` onto
// the global (observed with vitest 3.2 + jsdom 26): prefer the real jsdom
// Storage, fall back to an in-memory stub so preference persistence works.
declare const window: typeof globalThis & { localStorage?: Storage };
if (typeof globalThis.localStorage === "undefined") {
  const fromJsdom = typeof window !== "undefined" ? window.localStorage : undefined;
  if (fromJsdom) {
    Object.defineProperty(globalThis, "localStorage", {
      value: fromJsdom,
      configurable: true,
      writable: true,
    });
  } else {
    const store = new Map<string, string>();
    const stub: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: stub,
      configurable: true,
      writable: true,
    });
  }
}
