// ─── Database / Domain Types ──────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: ApiError };

// ─── Utility Types ────────────────────────────────────────────────────────────

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type WithId<T> = T & { id: string };
