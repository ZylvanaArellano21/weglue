"use client";

import { useState } from "react";

interface OfficerClubTagsProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  /** Renders the tag content for one item (the click target lives in here). */
  renderItem: (item: T) => React.ReactNode;
  /** How many tags to show while collapsed. */
  max?: number;
  /** Classes for the outer container. */
  className?: string;
  /** Classes for each one-line tag row. */
  rowClassName?: string;
}

/**
 * Officer club tags on a profile card (web).
 *
 * Collapsed: up to `max` (3) tags, each forced onto ONE line with an ellipsis,
 * so a long club name / handle can never escape the card. More than `max`
 * shows a "+N more" toggle that expands the SAME card in place — no navigation,
 * no modal. Expanded shows every tag plus a "See less" toggle. Tapping a tag
 * still opens that club (the click target is inside `renderItem`).
 */
export function OfficerClubTags<T>({
  items,
  itemKey,
  renderItem,
  max = 3,
  className = "",
  rowClassName = "",
}: OfficerClubTagsProps<T>): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, max);
  const hidden = items.length - max;

  return (
    <div className={className}>
      {visible.map((item) => (
        <div
          key={itemKey(item)}
          className={`max-w-full overflow-hidden text-ellipsis whitespace-nowrap ${rowClassName}`}
        >
          {renderItem(item)}
        </div>
      ))}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 text-[13px] font-medium text-teal hover:underline focus:outline-none focus-visible:underline"
        >
          {expanded ? "See less" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}
