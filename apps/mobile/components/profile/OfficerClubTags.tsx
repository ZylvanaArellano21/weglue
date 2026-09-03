import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { profileColors, profileFonts } from './profileTheme';

export interface OfficerRole {
  club_id: string;
  club_name: string;
  role_title: string;
}

interface Props {
  roles: OfficerRole[];
  /** Opens the club when the tag itself is tapped. */
  onOpenClub: (clubId: string) => void;
  /** How many tags to show while collapsed. */
  max?: number;
}

/**
 * Officer club tags on the profile card.
 *
 * Collapsed: up to `max` (3) tags, each on ONE line — a long club name
 * truncates with an ellipsis and can never push out of the card. More than
 * `max` shows a "+N more" toggle that expands the SAME card in place (no
 * navigation, no sheet); expanded shows every tag and a "See less" toggle.
 * Tapping a tag still opens that club.
 */
export function OfficerClubTags({ roles, onOpenClub, max = 3 }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!roles || roles.length === 0) return null;

  const visible = expanded ? roles : roles.slice(0, max);
  const hidden = roles.length - max;

  return (
    <View style={{ marginBottom: 16 }}>
      {visible.map((role) => (
        <TouchableOpacity
          key={role.club_id}
          onPress={() => {
            if (role.club_id) onOpenClub(role.club_id);
          }}
          activeOpacity={0.7}
          style={{ marginBottom: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`@${role.club_name}${role.role_title ? `, ${role.role_title}` : ''}`}
        >
          {/* Nested <Text> keeps the two colours while numberOfLines={1} keeps
              the whole tag on one line and adds the ellipsis. */}
          <Text numberOfLines={1} style={{ fontSize: 13 }}>
            <Text
              style={{
                color: profileColors.teal,
                fontFamily: profileFonts.semiBold,
              }}
            >
              @{role.club_name}
            </Text>
            {role.role_title ? (
              <Text
                style={{
                  color: profileColors.textLight,
                  fontFamily: profileFonts.regular,
                }}
              >
                {'  '}
                {role.role_title}
              </Text>
            ) : null}
          </Text>
        </TouchableOpacity>
      ))}

      {hidden > 0 ? (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.7}
          style={{ marginTop: 2 }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
        >
          <Text
            style={{
              fontSize: 13,
              color: profileColors.teal,
              fontFamily: profileFonts.medium,
            }}
          >
            {expanded ? 'See less' : `+${hidden} more`}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
