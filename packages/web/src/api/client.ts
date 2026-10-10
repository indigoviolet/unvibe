/**
 * Typed API client. Token: read from the URL (`?token=`) on first load,
 * then persisted in `localStorage` (and mirrored to the `__unvibe_token`
 * cookie so static loads authenticate). Sent as `Authorization: Bearer`.
 */
import type {
  AcceptContributionResponse,
  ActionResponse,
  AddRepoRequest,
  ChangesFilter,
  ContributionsResponse,
  CreateCommentRequest,
  CreateCommentResponse,
  CreateReviewRequest,
  DeleteContributionResponse,
  DismissContributionResponse,
  ExistingCommentsResponse,
  HealthResponse,
  Job,
  JobPromptResponse,
  JobResponse,
  JobsResponse,
  ModelsResponse,
  PromptsResponse,
  ReadinessResponse,
  RefreshResponse,
  ReplyCommentRequest,
  ReposResponse,
  RepoChangesResponse,
  ReviewAction,
  ReviewSnapshot,
  ReviewsListResponse,
  Settings,
  SubmitPreview,
  SubmitReviewRequest,
  SubmitReviewResponse,
  SummarizeHunkResponse,
  UpdateCommentRequest,
  UpdateDescriptionRequest,
  UpdateHunkRequest,
  UpdateReviewResponse,
  ViewerResponse,
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

/**
 * Plain-words error detail for toasts: what happened and what to do, never
 * a method/path/status-code transport prefix and never raw JSON. Callers
 * already say what they were doing ("Couldn't save the draft: …").
 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|offline/i.test(raw)) {
    return "you're offline — try again when connected";
  }
  const m = raw.match(/^[A-Z]+ \/\S+: (\d{3})?\s?([\s\S]*)$/);
  const body = (m?.[2] ?? raw).trim();
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim() !== "") {
      return parsed.error.trim().slice(0, 220);
    }
  } catch {
    // Not JSON: fall through to status-mapped copy.
  }
  switch (m?.[1]) {
    case "401":
      return "the service refused the token — reload the page";
    case "404":
      return "not found — it may have been removed";
    case "409":
      return body.slice(0, 220) || "conflicting change — refresh and try again";
    case "500":
    case "502":
      return "the service couldn't reach the repo or the agent — try again";
    default:
      return body.slice(0, 220) || "something went wrong — try again";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  // Only claim JSON when there is a body: Fastify 400s a bodyless POST
  // that carries `content-type: application/json` (refresh, update,
  // summarize, cancel all post without one).
  const hasBody = init?.body !== undefined;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
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
  reviews: (): Promise<ReviewsListResponse> => get("/api/reviews"),
  deleteReview: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/reviews/${encodeURIComponent(id)}`, { method: "DELETE" }),
  readiness: (force?: boolean): Promise<ReadinessResponse> =>
    get(`/api/readiness${force ? "?force=1" : ""}`),
  review: (id: string, version?: number): Promise<ReviewSnapshot> =>
    get(`/api/reviews/${encodeURIComponent(id)}${version !== undefined ? `?version=${version}` : ""}`),
  refresh: (id: string): Promise<RefreshResponse> => post(`/api/reviews/${encodeURIComponent(id)}/refresh`),
  update: (id: string): Promise<UpdateReviewResponse> => post(`/api/reviews/${encodeURIComponent(id)}/update`),
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

  viewer: (): Promise<ViewerResponse> => get("/api/viewer"),
  settings: (): Promise<Settings> => get("/api/settings"),
  saveSettings: (body: Partial<Settings>): Promise<Settings> =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  models: (provider: string): Promise<ModelsResponse> =>
    get(`/api/models?provider=${encodeURIComponent(provider)}`),

  prompts: (reviewId?: string): Promise<PromptsResponse> =>
    get(`/api/prompts${reviewId ? `?review=${encodeURIComponent(reviewId)}` : ""}`),
  jobs: (reviewId?: string): Promise<JobsResponse> =>
    get(`/api/jobs${reviewId ? `?review=${encodeURIComponent(reviewId)}` : ""}`),
  job: (id: string): Promise<JobResponse> => get(`/api/jobs/${encodeURIComponent(id)}`),
  jobPrompt: (id: string): Promise<JobPromptResponse> =>
    get(`/api/jobs/${encodeURIComponent(id)}/prompt`),
  cancelJob: (id: string): Promise<{ job: Job }> => post(`/api/jobs/${encodeURIComponent(id)}/cancel`),
  setJobPriority: (id: string, priority: number): Promise<{ job: Job }> =>
    request(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ priority }),
    }),

  contributions: (reviewId: string): Promise<ContributionsResponse> =>
    get(`/api/reviews/${encodeURIComponent(reviewId)}/contributions`),
  deleteContribution: (reviewId: string, contributionId: string): Promise<DeleteContributionResponse> =>
    request(`/api/reviews/${encodeURIComponent(reviewId)}/contributions/${encodeURIComponent(contributionId)}`, {
      method: "DELETE",
    }),
  acceptContribution: (reviewId: string, contributionId: string): Promise<AcceptContributionResponse> =>
    post(`/api/reviews/${encodeURIComponent(reviewId)}/contributions/${encodeURIComponent(contributionId)}/accept`),
  dismissContribution: (reviewId: string, contributionId: string): Promise<DismissContributionResponse> =>
    post(`/api/reviews/${encodeURIComponent(reviewId)}/contributions/${encodeURIComponent(contributionId)}/dismiss`),
};

export type ApiClient = typeof realApi;

export const api: ApiClient = MOCK ? mockApi : realApi;
