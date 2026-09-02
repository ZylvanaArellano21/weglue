"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import qrcodegen from "qrcode-generator";
import { DownloadIcon, LinkIcon, ShareIcon } from "./icons";

// ─── We Glue QR share screen (phone web) ────────────────────────────────────
// The phone-web counterpart of apps/mobile/components/share/QrShareScreen.tsx:
// one cream/teal screen for a club profile or club Members chat. The QR value
// is ALWAYS the same string as Copy link and Share. Download writes the
// identity + QR card (no action buttons) as a PNG.
//
// Larger screens (tablet / desktop) keep their existing inline QR — callers
// only mount this at phone width.

const CREAM = "#FEFCF0";
const TEAL = "#0FA6A6";
const INK = "#1A1A1A";

// Matches the `md:hidden` breakpoint (Tailwind `md` = 768px) used for the
// phone-only banner controls, so the Share button and this screen appear and
// disappear together.
const PHONE_MAX_WIDTH = 767;

/**
 * True at phone width. The full-screen QR share screen is a phones-only
 * surface — tablet and desktop keep their existing inline QR. SSR-safe:
 * returns false until mounted, so the server render never emits it.
 */
export function useIsPhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isPhone;
}

function qrModules(value: string): boolean[][] {
  const qr = qrcodegen(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const grid: boolean[][] = [];
  for (let r = 0; r < count; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
    grid.push(row);
  }
  return grid;
}

export interface QrShareScreenProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** URL the QR encodes — identical to Copy link and Share. */
  url: string;
  /** Middle button label. Default "Share". */
  shareLabel?: string;
  /** Sentence prefixed to the URL when the OS share sheet is used. */
  shareMessage: string;
  /** File-name stem (no extension) for the downloaded PNG. */
  fileName: string;
}

export function QrShareScreen({
  open,
  onClose,
  title,
  subtitle,
  url,
  shareLabel = "Share",
  shareMessage,
  fileName,
}: QrShareScreenProps): JSX.Element | null {
  const modules = useMemo(() => qrModules(url), [url]);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Clicking the code opens a plain full-screen QR (just the code) so another
  // phone can scan it from a distance.
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomed) setZoomed(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, zoomed]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setNote(null);
      setZoomed(false);
    }
  }, [open]);

  if (!open) return null;

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const qrPx = 232;
  const cell = qrPx / modules.length;
  // The enlarged QR fills the shorter screen edge (bounded so it stays sharp
  // on a wide desktop window).
  const zoomPx =
    typeof window !== "undefined"
      ? Math.min(window.innerWidth, window.innerHeight) - 48
      : 320;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote("Couldn't copy — select and copy the link manually.");
    }
  }

  async function share() {
    if (canNativeShare) {
      try {
        await navigator.share({ title, text: shareMessage, url });
      } catch {
        // dismissed
      }
      return;
    }
    void copyLink();
  }

  // Render the card to an offscreen canvas (cream ground, identity, QR modules)
  // and trigger a normal file download. No external rasteriser needed.
  async function download() {
    try {
      const scale = 3;
      const pad = 28;
      const w = pad * 2 + qrPx;
      const headerH = subtitle ? 108 : 84;
      const footerH = 44;
      const h = headerH + qrPx + footerH + pad;
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.scale(scale, scale);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = CREAM;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = "center";
      ctx.fillStyle = INK;
      ctx.font = "700 24px Zain, Georgia, serif";
      ctx.fillText(title, w / 2, 46);
      if (subtitle) {
        ctx.fillStyle = "#5F5D5D";
        ctx.font = "600 15px Inter, system-ui, sans-serif";
        ctx.fillText(subtitle, w / 2, 70);
      }

      const qrY = headerH;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(pad - 8, qrY - 8, qrPx + 16, qrPx + 16);
      ctx.fillStyle = "#000000";
      modules.forEach((row, r) => {
        row.forEach((dark, c) => {
          if (dark) {
            ctx.fillRect(
              pad + c * cell,
              qrY + r * cell,
              Math.ceil(cell),
              Math.ceil(cell)
            );
          }
        });
      });

      ctx.fillStyle = TEAL;
      ctx.font = "700 16px Zain, Georgia, serif";
      ctx.fillText("We Glue", w / 2, qrY + qrPx + 30);

      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/png")
      );
      if (!blob) throw new Error("no blob");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${fileName}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setNote("Image downloaded");
      setTimeout(() => setNote(null), 2500);
    } catch {
      setNote("Couldn't download the image — try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col"
      style={{ backgroundColor: CREAM }}
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${title}`}
    >
      <div className="flex items-center h-12 px-3">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 text-xl leading-none text-[#1A1A1A]"
        >
          ×
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setZoomed(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setZoomed(true);
            }
          }}
          className="w-full flex flex-col items-center rounded-[28px] bg-white px-7 pt-7 pb-6 shadow-xl cursor-pointer"
          style={{ maxWidth: 340 }}
          aria-label="Enlarge QR code"
        >
          <Image src="/logo.png" alt="We Glue" width={48} height={44} priority />
          <p
            className="mt-3 text-center text-2xl font-bold"
            style={{ fontFamily: "Zain, serif", color: INK }}
          >
            {title}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-center text-sm font-semibold text-[#5F5D5D]">
              {subtitle}
            </p>
          )}
          <div className="mt-5 rounded-xl bg-white p-3">
            <svg
              width={qrPx}
              height={qrPx}
              viewBox={`0 0 ${qrPx} ${qrPx}`}
              role="img"
              aria-label="QR code"
            >
              <rect width={qrPx} height={qrPx} fill="#fff" />
              {modules.map((row, r) =>
                row.map((dark, c) =>
                  dark ? (
                    <rect
                      key={`${r}-${c}`}
                      x={c * cell}
                      y={r * cell}
                      width={cell}
                      height={cell}
                      fill="#000"
                    />
                  ) : null
                )
              )}
            </svg>
          </div>
          <p
            className="mt-4 text-base font-bold"
            style={{ fontFamily: "Zain, serif", color: TEAL }}
          >
            We Glue
          </p>
        </div>
        <p className="mt-4 text-center text-[13px] text-[#5F5D5D]">
          {copied ? "Link copied" : "Click the code to enlarge it for scanning"}
        </p>
      </div>

      <div className="flex items-start justify-center gap-3 px-6 pb-2">
        <ActionButton
          onClick={() => void copyLink()}
          label={copied ? "Copied" : "Copy link"}
        >
          <LinkIcon size={20} />
        </ActionButton>
        <ActionButton onClick={() => void share()} label={shareLabel}>
          <ShareIcon size={20} />
        </ActionButton>
        <ActionButton onClick={() => void download()} label="Download">
          <DownloadIcon size={20} />
        </ActionButton>
      </div>
      <p className="pb-6 text-center text-[13px] font-medium text-[#0FA6A6] min-h-[20px]">
        {note ?? " "}
      </p>

      {/* Full-screen QR — just the code on white, nothing else. Click anywhere
          to go back. This is what opens when the code on the card is clicked. */}
      {zoomed && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setZoomed(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
              e.preventDefault();
              setZoomed(false);
            }
          }}
          aria-label="Close enlarged QR code"
          className="absolute inset-0 z-[1010] flex flex-col items-center justify-center gap-5 bg-white cursor-pointer p-6"
        >
          <svg
            width={zoomPx}
            height={zoomPx}
            viewBox={`0 0 ${modules.length} ${modules.length}`}
            role="img"
            aria-label="QR code"
            shapeRendering="crispEdges"
          >
            <rect width={modules.length} height={modules.length} fill="#fff" />
            {modules.map((row, r) =>
              row.map((dark, c) =>
                dark ? (
                  <rect key={`z-${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill="#000" />
                ) : null
              )
            )}
          </svg>
          <p className="text-center text-[13px] text-[#5F5D5D]">Click anywhere to close</p>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[84px] flex-col items-center gap-1.5"
    >
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#0FA6A6]/10 text-[#0FA6A6]">
        {children}
      </span>
      <span className="text-[13px] font-semibold text-[#1A1A1A]">{label}</span>
    </button>
  );
}
