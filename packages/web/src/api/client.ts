/**
 * Typed API client. Token: read from the URL (`?token=`) on first load,
 * then persisted in `localStorage` (and mirrored to the `__unvibe_token`
 * cookie so static loads authenticate). Sent as `Authorization: Bearer`.
 */
import type {
  ActionResponse,
  AddRepoRequest,
  ChangesFilter,
  CreateCommentRequest,
  CreateCommentResponse,
  CreateReviewRequest,
  ExistingCommentsResponse,
  HealthResponse,
  JobsResponse,
  PromptsResponse,
  RefreshResponse,
  ReplyCommentRequest,
  ReposResponse,
  RepoChangesResponse,
  ReviewAction,
  ReviewSnapshot,
  Settings,
  SubmitPreview,
  SubmitReviewRequest,
  SubmitReviewResponse,
  SummarizeHunkResponse,
  UpdateCommentRequest,
  UpdateDescriptionRequest,
  UpdateHunkRequest,
} from "@unvibe/shared";
// Static import keeps mock timing deterministic in dev; the mock modules are
// data + an in-memory client with no side effects on import, so bundlers can
// drop them from production builds where VITE_MOCK is unset.
import { mockApi } from "../mock/index.js";

const TOKEN_KEY = "unvibe_token";
const TOKEN_COOKIE = "__unvibe_token";

export function initTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(fromUrl)}; SameSite=Lax; path=/`;
    // Strip the token from the address bar without reloading.
    params.delete("token");
    const rest = params.toString();
    const clean = window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash;
    window.history.replaceState(null, "", clean);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) throw new Error("unauthorized: missing or invalid token");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path}: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);
const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Mock mode (`VITE_MOCK=1`, `mise run dev:mock`): the API client is replaced
 * by an in-memory implementation of the same typed interface, serving a
 * `ReviewSnapshot` fixture and applying mutations through the WS-patch path.
 */
const MOCK = typeof import.meta !== "undefined" && import.meta.env?.VITE_MOCK === "1";

const realApi = {
  health: (): Promise<HealthResponse> => fetch("/api/health").then((r) => r.json()),

  repos: (): Promise<ReposResponse> => get("/api/repos"),
  addRepo: (body: AddRepoRequest): Promise<ReposResponse> =>
    request("/api/repos", { method: "POST", body: JSON.stringify(body) }),
  repoChanges: (id: string, filter?: ChangesFilter): Promise<RepoChangesResponse> =>
    get(`/api/repos/${encodeURIComponent(id)}/changes${filter ? `?filter=${filter}` : ""}`),

  createReview: (body: CreateReviewRequest): Promise<ReviewSnapshot> =>
    post("/api/reviews", body),
  review: (id: string): Promise<ReviewSnapshot> => get(`/api/reviews/${encodeURIComponent(id)}`),
  refresh: (id: string): Promise<RefreshResponse> => post(`/api/reviews/${encodeURIComponent(id)}/refresh`),
  update: (id: string): Promise<RefreshResponse> => post(`/api/reviews/${encodeURIComponent(id)}/update`),
  action: (id: string, action: ReviewAction): Promise<ActionResponse> =>
    post(`/api/reviews/${encodeURIComponent(id)}/actions`, action),

  updateHunk: (id: string, hash: string, body: UpdateHunkRequest): Promise<{ ok: boolean }> =>
    request(`/api/reviews/${encodeURIComponent(id)}/hunks/${encodeURIComponent(hash)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  summarizeHunk: (id: string, hash: string): Promise<SummarizeHunkResponse> =>
    post(`/api/reviews/${encodeURIComponent(id)}/hunks/${encodeURIComponent(hash)}/summarize`),

  createComment: (reviewId: string, body: CreateCommentRequest): Promise<CreateCommentResponse> =>
    request(`/api/reviews/${encodeURIComponent(reviewId)}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  replyComment: (reviewId: string, commentId: string, body: ReplyCommentRequest): Promise<{ ok: boolean }> =>
    post(`/api/reviews/${encodeURIComponent(reviewId)}/comments/${encodeURIComponent(commentId)}/replies`, body),
  updateComment: (reviewId: string, commentId: string, body: UpdateCommentRequest): Promise<{ ok: boolean }> =>
    request(`/api/reviews/${encodeURIComponent(reviewId)}/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteComment: (reviewId: string, commentId: string): Promise<{ ok: boolean }> =>
    request(`/api/reviews/${encodeURIComponent(reviewId)}/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
    }),

  updateDescription: (id: string, body: UpdateDescriptionRequest): Promise<{ ok: boolean; changed?: boolean }> =>
    request(`/api/reviews/${encodeURIComponent(id)}/description`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  revertDescription: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/reviews/${encodeURIComponent(id)}/description`, { method: "DELETE" }),
  submit: (id: string, body: SubmitReviewRequest): Promise<SubmitReviewResponse> =>
    post(`/api/reviews/${encodeURIComponent(id)}/submit`, body),
  submitPreview: (id: string): Promise<{ preview: SubmitPreview }> =>
    get(`/api/reviews/${encodeURIComponent(id)}/submit/preview`),
  prComments: (id: string): Promise<ExistingCommentsResponse> =>
    get(`/api/reviews/${encodeURIComponent(id)}/pr-comments`),

  settings: (): Promise<Settings> => get("/api/settings"),
  saveSettings: (body: Settings): Promise<Settings> =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),

  prompts: (reviewId?: string): Promise<PromptsResponse> =>
    get(`/api/prompts${reviewId ? `?review=${encodeURIComponent(reviewId)}` : ""}`),
  jobs: (reviewId?: string): Promise<JobsResponse> =>
    get(`/api/jobs${reviewId ? `?review=${encodeURIComponent(reviewId)}` : ""}`),
};

export type ApiClient = typeof realApi;

export const api: ApiClient = MOCK ? mockApi : realApi;
