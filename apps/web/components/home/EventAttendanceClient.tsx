"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSupabaseBrowser } from "../../lib/supabase-browser";
import { formatEventTime } from "../../lib/datetime";
import { ToastProvider, useToast } from "../shared/Toast";

// ─── Event attendance (event ⋯ → Attendance) ────────────────────────────────
// Officers/advisors only. Shows the event's check-in roster — Student ID and
// school email ONLY, never names or check-in timestamps — plus Export
// (PDF/CSV). No open/close/extend controls in V1.

interface AttendanceRow {
  student_id: string;
  school_email: string;
}

interface EventHeader {
  club_name: string;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
}

function formatLongDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function EventAttendanceClient(props: { eventId: string; userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <EventAttendanceBody {...props} />
    </ToastProvider>
  );
}

function EventAttendanceBody({ eventId }: { eventId: string; userId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [header, setHeader] = useState<EventHeader | null>(null);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select("title, event_date, start_time, end_time, clubs!inner(name)")
        .eq("id", eventId)
        .maybeSingle();
      const { data: attendance, error: attendanceError } = await supabase.rpc("list_event_attendance", {
        p_event_id: eventId,
      });
      if (cancelled) return;
      if (attendanceError?.message?.toLowerCase().includes("not authorized") || attendanceError?.code === "42501") {
        setPhase("forbidden");
        return;
      }
      if (eventError || !eventRow || attendanceError) {
        setPhase("error");
        return;
      }
      setHeader({
        club_name: (eventRow as any).clubs.name,
        title: (eventRow as any).title,
        event_date: (eventRow as any).event_date,
        start_time: (eventRow as any).start_time,
        end_time: (eventRow as any).end_time,
      });
      setRows((attendance ?? []) as AttendanceRow[]);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function exportPdf() {
    if (!header) return;
    setExporting(true);
    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
      const pageWidth = 612;
      const pageHeight = 792;
      const margin = 48;
      let page = doc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const drawHeaderLine = (label: string, value: string) => {
        page.drawText(label, { x: margin, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
        page.drawText(value, { x: margin + 110, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 18;
      };
      page.drawText("Attendance Export", { x: margin, y, size: 16, font: boldFont });
      y -= 26;
      drawHeaderLine("Club:", header.club_name);
      drawHeaderLine("Event:", header.title);
      drawHeaderLine("Date:", formatLongDate(header.event_date));
      drawHeaderLine("Time:", `${formatEventTime(header.start_time)} - ${formatEventTime(header.end_time)}`);
      y -= 12;

      const col1X = margin;
      const col2X = margin + 260;
      const rowHeight = 20;

      const drawTableHeader = () => {
        page.drawRectangle({ x: margin, y: y - 4, width: pageWidth - margin * 2, height: rowHeight, color: rgb(0.94, 0.94, 0.94) });
        page.drawText("Student ID", { x: col1X + 6, y, size: 10, font: boldFont });
        page.drawText("School email", { x: col2X + 6, y, size: 10, font: boldFont });
        y -= rowHeight;
      };
      drawTableHeader();

      for (const row of rows) {
        if (y < margin + rowHeight) {
          page = doc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
          drawTableHeader();
        }
        page.drawLine({
          start: { x: margin, y: y + rowHeight - 4 },
          end: { x: pageWidth - margin, y: y + rowHeight - 4 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.85),
        });
        page.drawText(row.student_id, { x: col1X + 6, y, size: 10, font });
        page.drawText(row.school_email, { x: col2X + 6, y, size: 10, font });
        y -= rowHeight;
      }

      const bytes = await doc.save();
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${slugify(header.title)}-attendance.pdf`);
    } catch {
      show("Could not generate the PDF. Try again.", "error");
    } finally {
      setExporting(false);
    }
  }

  function exportCsv() {
    if (!header) return;
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = ["Student ID,School email", ...rows.map((r) => `${escape(r.student_id)},${escape(r.school_email)}`)];
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${slugify(header.title)}-attendance.csv`);
  }

  if (phase === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-cream" />;
  }

  if (phase === "forbidden") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <p className="text-[15px] text-gray-600">Only club officers and advisors can view this.</p>
        <button type="button" onClick={() => router.back()} className="font-semibold text-teal">
          Go back
        </button>
      </div>
    );
  }

  if (phase === "error" || !header) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <p className="text-[15px] text-gray-600">Couldn&apos;t load attendance. Try again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-2xl px-5 py-6">
        <div className="mb-4 flex items-center justify-between">
          <button type="button" onClick={() => router.back()} aria-label="Back" className="text-2xl leading-none text-gray-800">
            ‹
          </button>
          <div className="relative">
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border-[1.5px] border-teal px-4 py-1.5 text-sm font-semibold text-teal">
                Export
              </summary>
              <div className="absolute right-0 z-10 mt-1 min-w-[140px] overflow-hidden rounded-xl bg-white shadow-lg">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void exportPdf()}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-black/[0.03] disabled:opacity-50"
                >
                  {exporting ? "Generating…" : "PDF"}
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-black/[0.03]"
                >
                  CSV
                </button>
              </div>
            </details>
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-gray-900 font-zain">{header.title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {header.club_name} · {rows.length} checked in
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl bg-white shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-500">No check-ins yet.</p>
          ) : (
            rows.map((row, i) => (
              <div key={i} className="border-b border-black/5 px-5 py-3 last:border-b-0">
                <p className="text-sm font-semibold text-gray-900">{row.student_id}</p>
                <p className="mt-0.5 text-[13px] text-gray-500">{row.school_email}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
