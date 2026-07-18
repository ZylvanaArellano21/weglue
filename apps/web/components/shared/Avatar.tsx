// Web port of apps/mobile/components/shared/Avatar.tsx. Avatar URLs in the
// shared backend can be a real image URL, a `preset:<color>` solid circle, or
// a `text:<content>` monogram — all three must render identically to mobile.

export function parsePresetColor(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("preset:")) return uri.slice("preset:".length);
  return null;
}

export function parseTextAvatar(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("text:")) return uri.slice("text:".length);
  return null;
}

interface AvatarProps {
  uri: string | null | undefined;
  size?: number;
  /** Name used for the fallback monogram. */
  name?: string;
  className?: string;
}

export function Avatar({ uri, size = 40, name, className }: AvatarProps): JSX.Element {
  const initials = name ? name.slice(0, 2).toUpperCase() : "?";
  const presetColor = parsePresetColor(uri);
  const textContent = parseTextAvatar(uri);
  const isImage = !!uri && !presetColor && !textContent;

  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "9999px",
    flexShrink: 0,
  };

  if (textContent) {
    return (
      <span
        className={className}
        style={{
          ...base,
          background: "#0FA6A6",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: size * 0.35,
        }}
      >
        {textContent}
      </span>
    );
  }

  if (presetColor) {
    return (
      <span
        className={className}
        style={{
          ...base,
          background: presetColor,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: size * 0.35,
        }}
      >
        {initials}
      </span>
    );
  }

  if (isImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={uri as string}
        alt={name ?? "avatar"}
        className={className}
        style={{ ...base, objectFit: "cover", background: "#E5E7EB" }}
      />
    );
  }

  return (
    <span
      className={className}
      style={{
        ...base,
        background: "#0FA6A6",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.35,
      }}
    >
      {initials}
    </span>
  );
}
