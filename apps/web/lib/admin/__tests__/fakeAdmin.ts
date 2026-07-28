import { vi } from "vitest";

// Shared in-memory PostgREST-style fake for the service-role client, extended
// beyond the per-file harnesses with: neq, is/not-null, gte/lte, ilike (no-op
// safe), a chainable order/range/limit, and an optional auth.admin mock. Only
// the subset of behaviour the Day-5 loaders/actions use is implemented.

export interface FakeAuthUser {
  id: string;
  email: string | null;
}

export function makeDb(initial: Record<string, any[]>, authUsers: FakeAuthUser[] = []) {
  const tables: Record<string, any[]> = {};
  for (const k of Object.keys(initial)) tables[k] = (initial[k] ?? []).map((r) => ({ ...r }));

  function from(table: string) {
    const st: any = { table, op: "select", filters: [], update: null, insert: null };
    const b: any = {
      select(_c: string, opts?: any) {
        st.head = !!opts?.head;
        st.count = !!opts?.count;
        return b;
      },
      insert(v: any) {
        st.op = "insert";
        st.insert = Array.isArray(v) ? v : [v];
        return b;
      },
      update(v: any) {
        st.op = "update";
        st.update = v;
        return b;
      },
      delete() {
        st.op = "delete";
        return b;
      },
      eq(col: string, val: any) {
        st.filters.push({ type: "eq", col, val });
        return b;
      },
      neq(col: string, val: any) {
        st.filters.push({ type: "neq", col, val });
        return b;
      },
      in(col: string, vals: any[]) {
        st.filters.push({ type: "in", col, vals });
        return b;
      },
      not(col: string, _op: string, val: any) {
        st.filters.push({ type: "not", col, val });
        return b;
      },
      is(col: string, val: any) {
        st.filters.push({ type: "is", col, val });
        return b;
      },
      gte(col: string, val: any) {
        st.filters.push({ type: "gte", col, val });
        return b;
      },
      lte(col: string, val: any) {
        st.filters.push({ type: "lte", col, val });
        return b;
      },
      ilike() {
        return b;
      },
      or() {
        return b;
      },
      order() {
        return b;
      },
      range() {
        return b;
      },
      limit() {
        return b;
      },
      maybeSingle() {
        return Promise.resolve(exec(true));
      },
      single() {
        return Promise.resolve(exec(true));
      },
      then(res: any, rej: any) {
        return Promise.resolve(exec(false)).then(res, rej);
      },
    };
    function match(row: any): boolean {
      return st.filters.every((f: any) => {
        if (f.type === "eq") return row[f.col] === f.val;
        if (f.type === "neq") return row[f.col] !== f.val;
        if (f.type === "in") return f.vals.includes(row[f.col]);
        if (f.type === "not") return f.val === null ? row[f.col] != null : row[f.col] !== f.val;
        if (f.type === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
        if (f.type === "gte") return row[f.col] >= f.val;
        if (f.type === "lte") return row[f.col] <= f.val;
        return true;
      });
    }
    function exec(single: boolean) {
      const arr = tables[table] || (tables[table] = []);
      if (st.op === "insert") {
        const rows = st.insert.map((r: any) => ({ id: r.id ?? `gen-${Math.random()}`, ...r }));
        arr.push(...rows);
        return { data: single ? rows[0] : rows, error: null };
      }
      const matched = arr.filter(match);
      if (st.op === "update") {
        matched.forEach((r) => Object.assign(r, st.update));
        return { data: single ? matched[0] ?? null : matched, error: null };
      }
      if (st.op === "delete") {
        tables[table] = arr.filter((r) => !match(r));
        return { data: null, error: null };
      }
      if (st.head && st.count) return { data: null, count: matched.length, error: null };
      if (single) return { data: matched[0] ?? null, error: null };
      return { data: matched, count: matched.length, error: null };
    }
    return b;
  }

  const auth = {
    admin: {
      listUsers: vi.fn(async ({ page = 1, perPage = 200 }: { page?: number; perPage?: number } = {}) => {
        const start = (page - 1) * perPage;
        const slice = authUsers.slice(start, start + perPage);
        return { data: { users: slice }, error: null };
      }),
      getUserById: vi.fn(async (id: string) => {
        const u = authUsers.find((x) => x.id === id) ?? null;
        return { data: { user: u }, error: null };
      }),
    },
  };

  return { from, tables, auth };
}
