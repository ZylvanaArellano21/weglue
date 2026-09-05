import { linkify } from "@weglue/shared";

/**
 * Drop-in replacement for interpolating raw user text (`{text}`) wherever a
 * caption, description, or message body is rendered. Any http(s)/www. URL
 * inside becomes a real, clickable <a> — everything else renders exactly as
 * plain text did before. No Markdown, no rich text, no link previews.
 */
export function LinkifiedText({
  text,
  linkClassName = "text-[#0FA6A6] underline break-all",
}: {
  text: string;
  linkClassName?: string;
}): JSX.Element {
  const segments = linkify(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "link" ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
            onClick={(e) => e.stopPropagation()}
          >
            {segment.value}
          </a>
        ) : (
          segment.value
        )
      )}
    </>
  );
}
