import {
  getPresetAvatar,
  parseLegacyPresetColor,
  parsePresetAvatarId,
  parseTextAvatar as parseTextAvatarValue,
} from "@weglue/shared";
import { getPresetAvatarSrc } from "../../lib/presetAvatarAssets";

// Web port of apps/mobile/components/shared/Avatar.tsx. Avatar URLs in the
// shared backend can be an uploaded image, `preset:<stable-id>`, legacy
// `preset:<color>`, or a `text:<content>` monogram. The resolver deliberately
// keeps legacy values intact so old profiles never become blank or change art.

export function parsePresetColor(uri: string | null | undefined): string | null {
  return parseLegacyPresetColor(uri);
}

export function parseTextAvatar(uri: string | null | undefined): string | null {
  return parseTextAvatarValue(uri);
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
  const presetAvatarId = parsePresetAvatarId(uri);
  const presetColor = parsePresetColor(uri);
  const textContent = parseTextAvatar(uri);
  const isImage = !!uri && !presetAvatarId && !presetColor && !textContent;

  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "9999px",
    flexShrink: 0,
  };

  if (presetAvatarId) {
    const avatar = getPresetAvatar(presetAvatarId);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={getPresetAvatarSrc(presetAvatarId)}
        alt={avatar?.label ?? name ?? "We Glue avatar"}
        className={className}
        style={{ ...base, objectFit: "cover", background: "#E5E7EB" }}
      />
    );
  }

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
