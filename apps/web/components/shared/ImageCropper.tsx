"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CropOutput {
  blob: Blob;
  width: number;
  height: number;
}

interface Props {
  /** Object URL or data URL of the image to crop. */
  src: string;
  /** Target frame ratio as [w, h] (avatar [1,1], banner [16,9], event [4,5]). */
  aspect: [number, number];
  title?: string;
  onCancel: () => void;
  onConfirm: (output: CropOutput) => void;
  busy?: boolean;
}

const MAX_ZOOM = 4;
const FRAME_W = 320;

/**
 * Move / zoom / reposition an image into a fixed-ratio frame, then confirm.
 *
 * Everything outside the frame is dimmed — the bright window is exactly what is
 * kept. Drag to reposition, scroll or use the slider to zoom. The image can
 * never be moved so far that a gap shows inside the frame. Nothing is produced
 * until "Use photo"; Cancel returns without changing the caller's image.
 */
export function ImageCropper({ src, aspect, title, onCancel, onConfirm, busy }: Props): JSX.Element {
  const frameW = FRAME_W;
  const frameH = Math.round((frameW * aspect[1]) / aspect[0]);

  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const working = useRef(false);

  // Cover-fit the source into the frame at zoom 1 (no gaps possible).
  const baseScale = nat ? Math.max(frameW / nat.w, frameH / nat.h) : 1;
  const fittedW = nat ? nat.w * baseScale : frameW;
  const fittedH = nat ? nat.h * baseScale : frameH;

  const clampPos = useCallback(
    (x: number, y: number, s: number) => {
      const maxX = Math.max(0, (fittedW * s - frameW) / 2);
      const maxY = Math.max(0, (fittedH * s - frameH) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [fittedW, fittedH, frameW, frameH],
  );

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  useEffect(() => {
    setPos((p) => clampPos(p.x, p.y, scale));
  }, [scale, clampPos]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = clampPos(
      drag.current.px + (e.clientX - drag.current.x),
      drag.current.py + (e.clientY - drag.current.y),
      scale,
    );
    setPos(next);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    setScale((s) => Math.min(MAX_ZOOM, Math.max(1, s - e.deltaY * 0.0015)));
  };

  const handleConfirm = async () => {
    if (!nat || working.current) return;
    working.current = true;
    try {
      const effScale = baseScale * scale;
      const cropW = Math.round(frameW / effScale);
      const cropH = Math.round(frameH / effScale);
      let originX = Math.round((-frameW / 2 - pos.x) / effScale + nat.w / 2);
      let originY = Math.round((-frameH / 2 - pos.y) / effScale + nat.h / 2);
      originX = Math.max(0, Math.min(originX, nat.w - cropW));
      originY = Math.max(0, Math.min(originY, nat.h - cropH));

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("load"));
        i.src = src;
      });

      // Cap the output so a huge source does not produce a huge JPEG.
      const outW = Math.min(cropW, 1600);
      const outH = Math.round((outW * cropH) / cropW);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.drawImage(img, originX, originY, cropW, cropH, 0, 0, outW, outH);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.9),
      );
      onConfirm({ blob, width: outW, height: outH });
    } catch {
      working.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="mb-3 text-center text-[15px] font-bold text-gray-900">
          {title ?? "Position your photo"}
        </h3>

        <div
          className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-black"
          style={{ width: frameW, height: frameH }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            style={{
              width: fittedW,
              height: fittedH,
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            }}
          />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/70" />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span aria-hidden className="text-xs text-gray-400">
            −
          </span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1 flex-1 cursor-pointer accent-teal"
          />
          <span aria-hidden className="text-xs text-gray-400">
            +
          </span>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy || working.current}
            className="flex-1 rounded-full border border-gray-200 bg-white py-2.5 text-[15px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || !nat || working.current}
            className="flex-1 rounded-full bg-teal py-2.5 text-[15px] font-semibold text-white disabled:opacity-50"
          >
            Use photo
          </button>
        </div>
      </div>
    </div>
  );
}
