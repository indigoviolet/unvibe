/**
 * #394: the worker must never resend a mutating call after its fetch
 * threw — the POST may have reached the service (a 30 s panel-ask abort
 * lands after the server stored the question and answer), and the retry
 * goes to the same service under its other host name. GETs keep their
 * cross-origin throw-retry; POSTs report the failure honestly instead.
 *
 * Loads the real `extension/background.js` with stubbed `chrome` +
 * `fetch` and drives the captured `onMessage` listener: a POST that
 * throws after receipt is sent exactly once, while a GET that throws
 * is still retried.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

interface StubResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchStub = (url: string, options?: { method?: string }) => Promise<StubResponse>;

const okHealth: StubResponse = { ok: true, status: 200, json: async () => ({ ok: true }) };

let fetchImpl: FetchStub = async () => okHealth;

const sentMessages: { method: string; url: string }[] = [];

async function stubFetch(url: string, options?: { method?: string }): Promise<StubResponse> {
  sentMessages.push({ method: options?.method ?? "GET", url });
  return fetchImpl(url, options);
}

type SendResponse = (r: unknown) => void;
type PanelListener = (msg: Record<string, unknown>, sender: unknown, send: SendResponse) => boolean;
let listener: PanelListener | null = null;

const chromeStub = {
  cookies: { get: async () => ({ name: "__unvibe_token", value: "tok" }) },
  sidePanel: { setPanelBehavior: async () => {} },
  runtime: {
    onMessage: { addListener: (fn: PanelListener) => { listener = fn; } },
    lastError: undefined,
  },
  tabs: {
    query: async () => [],
    create: async () => ({}),
    sendMessage: async () => ({}),
  },
};

function sendMsg(msg: Record<string, unknown>): Promise<unknown> {
  if (!listener) throw new Error("background listener not registered");
  return new Promise((resolve) => {
    void listener?.(msg, {}, resolve);
  });
}

function postCount(suffix: string): number {
  return sentMessages.filter((m) => m.method === "POST" && m.url.endsWith(suffix)).length;
}

beforeAll(async () => {
  vi.stubGlobal("chrome", chromeStub);
  vi.stubGlobal("fetch", stubFetch);
  const bg = pathToFileURL(fileURLToPath(new URL("../../../extension/background.js", import.meta.url)));
  await import(bg.href);
});

describe("extension retry rule (#394)", () => {
  it("a panel ask that aborts after receipt is sent exactly once and reports honestly", async () => {
    sentMessages.length = 0;
    let received = 0;
    fetchImpl = async (url, options) => {
      if ((options?.method ?? "GET") === "POST" && url.includes("/api/extension/panel/ask")) {
        received += 1;
        // The server stored the ask, then the client-side fetch aborted.
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return okHealth;
    };
    const reply = (await sendMsg({
      type: "unvibe:panel-ask",
      body: { url: "https://github.com/acme/app/pull/7", question: "Where is it?" },
    })) as Record<string, unknown>;
    expect(received).toBe(1);
    expect(postCount("/api/extension/panel/ask")).toBe(1);
    expect(reply).toMatchObject({ error: "request failed" });
  });

  it("a successful panel ask still passes through", async () => {
    sentMessages.length = 0;
    fetchImpl = async (url, options) => {
      if ((options?.method ?? "GET") === "POST" && url.includes("/api/extension/panel/ask")) {
        return { ok: true, status: 200, json: async () => ({ thread: { messages: [] } }) };
      }
      return okHealth;
    };
    const reply = (await sendMsg({
      type: "unvibe:panel-ask",
      body: { url: "https://github.com/acme/app/pull/7", question: "Where is it?" },
    })) as Record<string, unknown>;
    expect(postCount("/api/extension/panel/ask")).toBe(1);
    expect(reply).toMatchObject({ thread: { messages: [] } });
  });

  it("a GET that throws is still retried on the next origin", async () => {
    sentMessages.length = 0;
    let gets = 0;
    fetchImpl = async (url, options) => {
      if ((options?.method ?? "GET") === "GET" && url.includes("/api/extension/pr-status")) {
        gets += 1;
        if (gets === 1) throw new Error("connection refused");
        return { ok: true, status: 200, json: async () => ({ exists: false }) };
      }
      return okHealth;
    };
    const reply = (await sendMsg({
      type: "unvibe:pr-status",
      prUrl: "https://github.com/acme/app/pull/7",
    })) as Record<string, unknown>;
    expect(gets).toBe(2);
    expect(reply).toMatchObject({ state: "missing" });
  });

  it("an open that throws after receipt is sent exactly once and reports honestly", async () => {
    sentMessages.length = 0;
    let received = 0;
    fetchImpl = async (url, options) => {
      if ((options?.method ?? "GET") === "POST" && url.includes("/api/extension/open")) {
        received += 1;
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return okHealth;
    };
    const reply = (await sendMsg({
      type: "unvibe:open",
      prUrl: "https://github.com/acme/app/pull/7",
    })) as Record<string, unknown>;
    expect(received).toBe(1);
    expect(postCount("/api/extension/open")).toBe(1);
    expect(reply).toMatchObject({ ok: false, error: "request failed" });
  });
});
