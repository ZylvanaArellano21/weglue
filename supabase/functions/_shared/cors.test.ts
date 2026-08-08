import { assertEquals } from "jsr:@std/assert@1";

import { corsHeaders, handlePreflight, isAllowedOrigin } from "./cors.ts";

// Regression coverage for the defect these headers fix: the browser preflight
// for `functions.invoke()` was answered 405 with no Access-Control-Allow-Origin,
// so web "Unsend for everyone" and web "Report" could never send their POST.

Deno.test("preflight is answered for an allowed origin with the headers supabase-js needs", () => {
  const response = handlePreflight(
    new Request("https://x.functions.supabase.co/delete-message", {
      method: "OPTIONS",
      headers: { Origin: "https://weglue.app" },
    })
  );
  assertEquals(response?.status, 204);
  assertEquals(response?.headers.get("Access-Control-Allow-Origin"), "https://weglue.app");
  const allowed = response?.headers.get("Access-Control-Allow-Headers") ?? "";
  // Omitting any of these makes the preflight fail exactly as it did before.
  for (const header of ["authorization", "apikey", "content-type", "x-client-info"]) {
    assertEquals(allowed.includes(header), true, `missing ${header}`);
  }
  assertEquals((response?.headers.get("Access-Control-Allow-Methods") ?? "").includes("POST"), true);
});

Deno.test("an unknown origin is not granted access", () => {
  const response = handlePreflight(
    new Request("https://x.functions.supabase.co/delete-message", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    })
  );
  assertEquals(response?.status, 204);
  assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("the origin is echoed from an allowlist, never reflected blindly and never *", () => {
  assertEquals(isAllowedOrigin("https://weglue.app"), true);
  assertEquals(isAllowedOrigin("https://www.weglue.app"), true);
  assertEquals(isAllowedOrigin("https://we-glue-git-main-team.vercel.app"), true);
  assertEquals(isAllowedOrigin("http://localhost:3001"), true);
  assertEquals(isAllowedOrigin("https://weglue.app.attacker.example"), false);
  assertEquals(isAllowedOrigin("https://notweglue.app"), false);
  assertEquals(isAllowedOrigin(null), false);
  assertEquals(corsHeaders("https://weglue.app")["Access-Control-Allow-Origin"], "https://weglue.app");
  assertEquals(corsHeaders("https://attacker.example")["Access-Control-Allow-Origin"], undefined);
});

Deno.test("credentials are never granted and Vary: Origin is always set", () => {
  for (const origin of ["https://weglue.app", "https://attacker.example", null]) {
    const headers = corsHeaders(origin);
    assertEquals(headers["Access-Control-Allow-Credentials"], undefined);
    assertEquals(headers.Vary, "Origin");
  }
});

Deno.test("a non-preflight request is passed through untouched", () => {
  assertEquals(
    handlePreflight(new Request("https://x.functions.supabase.co/delete-message", { method: "POST" })),
    null
  );
});
