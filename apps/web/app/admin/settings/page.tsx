import Link from "next/link";
import { getAdminSettings, type CapabilityProbe } from "../../../lib/admin/settingsData";
import { SectionCard, Badge, Field } from "../../../components/admin/primitives";
import { SettingsActions } from "../../../components/admin/SettingsActions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function onOff(v: boolean, on = "Enabled", off = "Disabled") {
  return <Badge tone={v ? "green" : "gray"}>{v ? on : off}</Badge>;
}

/**
 * Render a live capability probe. `error` is shown in amber and never as a
 * green "active" — a status we could not verify must not read as working.
 */
function capability({ status, detail }: CapabilityProbe, activeLabel: string) {
  const tone = status === "active" ? "green" : status === "unavailable" ? "gray" : "amber";
  const label = status === "active" ? activeLabel : status === "unavailable" ? "Unavailable" : "Unverified";
  return (
    <>
      <Badge tone={tone}>{label}</Badge>
      <p className="mt-1 text-xs text-gray-400">{detail}</p>
    </>
  );
}

export default async function AdminSettingsPage() {
  const s = await getAdminSettings();

  const emailConsistencyBadge =
    s.admin.emailConsistency === "enforced_consistent" ? (
      <Badge tone="green">Enforced &amp; consistent</Badge>
    ) : s.admin.emailConsistency === "mismatch" ? (
      <Badge tone="red">Mismatch</Badge>
    ) : (
      <Badge tone="gray">Not configured (id-only)</Badge>
    );

  // Content-free diagnostics for the copy control (no secrets, no values).
  const diagnostics = {
    portalEnabled: s.portalEnabled,
    writesEnabled: s.writesEnabled,
    environment: s.environment,
    vercelEnv: s.vercelEnv,
    commit: s.commit,
    supabaseConnected: s.supabase.connected,
    mfa: s.mfa,
    auditPersistence: s.auditPersistence.status,
    privacyBackend: s.privacyBackend.status,
    commitRef: s.commitRef,
    envPresence: s.env.map((e) => ({ name: e.name, present: e.present })),
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Admin Settings</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Operational status and safe controls. No secret is ever displayed and no environment variable can be changed
          from the browser.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <SectionCard title="Access &amp; kill switches">
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Admin portal">{onOff(s.portalEnabled)}</Field>
            <Field label="Admin writes">{onOff(s.writesEnabled)}</Field>
            <Field label="Administrator">{s.admin.email ?? "—"}</Field>
            <Field label="Immutable admin id">
              <code className="break-all text-xs text-gray-600">{s.admin.userId}</code>
            </Field>
            <Field label="Email consistency">{emailConsistencyBadge}</Field>
            <Field label="Inactivity auto-lock">{Math.round(s.inactivityTimeoutMs / 60000)} min</Field>
            <Field label="Session maximum age">
              {s.sessionMaxAgeMinutes} min <span className="text-gray-400">(server-enforced)</span>
            </Field>
          </dl>
        </SectionCard>

        <SectionCard title="Multi-factor authentication">
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Assurance level">
              <Badge tone={s.mfa.meetsRequirement ? "green" : "red"}>{s.mfa.assuranceLevel ?? "unknown"}</Badge>
            </Field>
            <Field label="Meets requirement">{onOff(s.mfa.meetsRequirement, "aal2 ✓", "Below aal2")}</Field>
            <Field label="Recent MFA (step-up)">
              <Badge tone={s.mfa.recentMfa ? "green" : "amber"}>{s.mfa.recentMfa ? "Fresh" : "Not recent"}</Badge>
            </Field>
            <Field label="Step-up window">{Math.round(s.mfa.stepUpMaxAgeSeconds / 60)} min</Field>
          </dl>
        </SectionCard>

        <SectionCard title="Platform &amp; connectivity">
          <dl className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Environment">{s.environment}</Field>
            <Field label="Vercel env">{s.vercelEnv ?? "—"}</Field>
            <Field label="Deployed commit (Git)">
              {s.commit ? <code className="text-xs">{s.commit}</code> : "—"}
              {s.commitRef ? <span className="ml-2 text-xs text-gray-400">on {s.commitRef}</span> : null}
            </Field>
            <Field label="Supabase">
              <Badge tone={s.supabase.connected ? "green" : "red"}>{s.supabase.connected ? "Connected" : "Unreachable"}</Badge>
              {s.supabase.url_host ? <span className="ml-2 text-xs text-gray-400">{s.supabase.url_host}</span> : null}
            </Field>
            <Field label="Audit persistence">{capability(s.auditPersistence, "Active")}</Field>
            <Field label="Privacy backend">{capability(s.privacyBackend, "Deployed")}</Field>
          </dl>
        </SectionCard>

        <SectionCard title="Environment variables (presence only)">
          <ul className="divide-y divide-gray-100">
            {s.env.map((e) => (
              <li key={e.name} className="flex items-center justify-between px-4 py-2.5">
                <code className="text-xs text-gray-700">{e.name}</code>
                <div className="flex items-center gap-2">
                  {e.hint ? <span className="text-xs text-gray-400">{e.hint}</span> : null}
                  <Badge tone={e.present ? "green" : "gray"}>{e.present ? "present" : "absent"}</Badge>
                </div>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 pt-1 text-xs text-gray-400">
            Values are never shown. The service-role key, database password, JWTs, cookies, MFA secrets, and push tokens
            are never read by this page.
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Operational controls">
        <div className="space-y-4 p-4">
          <SettingsActions diagnostics={diagnostics} />
          <p className="text-xs text-gray-400">
            Lock signs the session out and forces a fresh login + MFA on return. Data Health, MFA re-challenge, and the
            connection test are read-only. Copy exports a content-free status summary.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Emergency operational procedures">
        <div className="space-y-3 p-4 text-sm text-gray-600">
          <p className="text-xs text-gray-400">
            These are operator actions performed in Vercel / Supabase — never browser-side mutations. Listed here as a
            runbook.
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium text-gray-800">Take the portal offline:</span> set{" "}
              <code>ADMIN_PORTAL_ENABLED</code> to anything other than <code>true</code> in Vercel and redeploy. Every
              page, loader, action, and route fails closed.
            </li>
            <li>
              <span className="font-medium text-gray-800">Freeze all writes:</span> set{" "}
              <code>ADMIN_WRITES_ENABLED</code> off. The dashboard stays fully read-only.
            </li>
            <li>
              <span className="font-medium text-gray-800">Revoke administrator sessions:</span> use “Lock portal” above,
              and/or sign the founder out of all sessions in Supabase Auth.
            </li>
            <li>
              <span className="font-medium text-gray-800">Rotate exposed credentials:</span> rotate the Supabase
              service-role key and any leaked secret in Vercel, then redeploy.
            </li>
            <li>
              <span className="font-medium text-gray-800">Review the trail:</span> grep the server logs for the{" "}
              <code>admin_audit</code> tag and review Vercel logs. See{" "}
              <Link href="/admin/audit-history" className="text-teal-600 hover:underline">
                Audit History
              </Link>
              .
            </li>
          </ol>
        </div>
      </SectionCard>
    </div>
  );
}
