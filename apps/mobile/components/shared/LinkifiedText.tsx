import { Text, type StyleProp, type TextStyle } from "react-native";
import * as Linking from "expo-linking";
import { linkify } from "@weglue/shared";

const DEFAULT_LINK_STYLE: TextStyle = {
  color: "#0FA6A6",
  textDecorationLine: "underline",
};

/**
 * Drop-in replacement for interpolating raw user text (`{text}`) wherever a
 * caption, description, or message body is rendered. Any http(s)/www. URL
 * inside becomes a real, tappable nested <Text onPress> — everything else
 * renders exactly as plain text did before. No Markdown, no rich text, no
 * link previews.
 *
 * Nest this inside an existing <Text> (omit `style`, it inherits) or use it
 * standalone with its own `style` — both are valid React Native <Text>
 * nesting patterns already used across this codebase.
 */
export function LinkifiedText({
  text,
  style,
  linkStyle = DEFAULT_LINK_STYLE,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const segments = linkify(text);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, i) =>
        segment.type === "link" ? (
          <Text
            key={i}
            style={linkStyle}
            onPress={() => {
              void Linking.openURL(segment.href);
            }}
          >
            {segment.value}
          </Text>
        ) : (
          segment.value
        )
      )}
    </Text>
  );
}
