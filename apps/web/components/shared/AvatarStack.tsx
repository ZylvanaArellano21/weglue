import { Avatar } from "./Avatar";

interface StackItem {
  id: string;
  username: string;
  avatar_url: string | null;
}

/** Overlapping row of up to 4 attendee avatars (mirrors mobile AvatarStack). */
export function AvatarStack({
  avatars,
  size = 26,
  overlap = 8,
}: {
  avatars: StackItem[];
  size?: number;
  overlap?: number;
}): JSX.Element {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {avatars.slice(0, 4).map((a, i) => (
        <span
          key={a.id}
          style={{
            marginLeft: i === 0 ? 0 : -overlap,
            display: "inline-flex",
            borderRadius: "9999px",
            boxShadow: "0 0 0 2px #FEFFF8",
          }}
        >
          <Avatar uri={a.avatar_url} size={size} name={a.username} />
        </span>
      ))}
    </span>
  );
}
