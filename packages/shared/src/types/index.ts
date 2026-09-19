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

export interface EventAttendance {
  id: string;
  eventId: string;
  clubId: string;
  userId: string;
  campus: string;
  studentId: string;
  schoolEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedAttendanceInfo {
  campus: string;
  studentId: string;
  schoolEmail: string;
  updatedAt: string;
}

export interface ActiveCheckinEvent {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface EventAttendanceSummary {
  clubId: string;
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  checkinApplies: true;
  windowStartsAt: string;
  windowEndsAt: string;
  currentCount: number;
  totalCount: number;
}

export interface ClubAttendanceSummary {
  clubId: string;
  checkinApplies: true;
  eventCount: number;
  currentCount: number;
  totalCount: number;
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: ApiError };

// ─── Utility Types ────────────────────────────────────────────────────────────

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type WithId<T> = T & { id: string };
