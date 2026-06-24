// ============================================================
// We Glue – Database Types
// Auto-mirrors 001_initial_schema.sql
// ============================================================

// ---- Enums / Literals -----------------------------------------

export type InterestOption =
  | 'Finance & Business'
  | 'Social Events'
  | 'Music'
  | 'Fashion'
  | 'Art & Culture'
  | 'Social Justice & Activism'
  | 'Numbers & Economics'
  | 'Gaming'
  | 'Health & Wellness'
  | 'Environment'
  | 'Sports & Athletics'
  | 'Community Service'
  | 'Crafts'
  | 'Religion'
  | 'Technology and Computer'
  | 'Film & Media'
  | 'Photography'
  | 'Strategy and Critical Thinking'
  | 'Writing'
  | 'Theater'
  | 'Travel & Languages'
  | 'Debate & Politics';

export type ActivityOption =
  | 'Projects'
  | 'Volunteering'
  | 'Workshops'
  | 'Campus Fairs'
  | 'Trips'
  | 'Study Groups'
  | 'Networking'
  | 'Tournaments'
  | 'Social Events'
  | 'Campus Tours';

export type FollowStatus = 'pending' | 'accepted';
export type ClubRole = 'member' | 'officer';
export type EventVisibility = 'everyone' | 'members' | 'specific';
export type PostType = 'picture' | 'event';
export type ConversationType = 'direct' | 'group' | 'club_group' | 'officer_chat';
export type MessageType = 'text' | 'image' | 'poll';
export type NotificationType =
  | 'follow_request'
  | 'follow_accepted'
  | 'event_rsvp'
  | 'new_event'
  | 'new_message'
  | 'gluemate';
export type EntityType = 'event' | 'club' | 'message';
export type RsvpStatus = 'going' | 'cant';

// ---- Table Interfaces -----------------------------------------

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  major: string | null;
  bio: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserInterest {
  id: string;
  user_id: string;
  interest: InterestOption;
}

export interface UserActivity {
  id: string;
  user_id: string;
  activity: ActivityOption;
}

export interface UserPrivacy {
  id: string;
  user_id: string;
  is_private: boolean;
  hide_interests: boolean;
  hide_events: boolean;
}

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: FollowStatus;
  created_at: string;
}

export interface Club {
  id: string;
  name: string;
  handle: string;
  description: string;
  avatar_url: string | null;
  banner_url: string | null;
  meeting_day: string | null;
  meeting_time_start: string | null; // HH:MM:SS
  meeting_time_end: string | null;   // HH:MM:SS
  meeting_location: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
  is_seed: boolean;
  claimed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClubGoal {
  id: string;
  club_id: string;
  goal_text: string;
  display_order: number;
}

export interface ClubInterest {
  id: string;
  club_id: string;
  interest: InterestOption;
}

export interface ClubMember {
  id: string;
  club_id: string;
  user_id: string;
  role: ClubRole;
  joined_at: string;
}

export interface ClubOfficer {
  id: string;
  club_id: string;
  user_id: string | null;
  display_name: string;
  role_title: string;
  avatar_url: string | null;
  display_order: number;
}

export interface ClubPhoto {
  id: string;
  club_id: string;
  url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  club_id: string;
  created_by: string;
  title: string;
  emoji: string | null;
  description: string | null;
  cover_image_url: string | null;
  event_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  end_time: string;   // HH:MM:SS
  location: string | null;
  building: string | null;
  room: string | null;
  visibility: EventVisibility;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventInterest {
  id: string;
  event_id: string;
  interest: string;
}

export interface EventActivity {
  id: string;
  event_id: string;
  activity: string;
}

export interface EventRsvp {
  id: string;
  event_id: string;
  user_id: string;
  status: RsvpStatus;
  created_at: string;
}

export interface SavedEvent {
  id: string;
  user_id: string;
  event_id: string;
  saved_at: string;
}

export interface Post {
  id: string;
  author_id: string;
  club_id: string | null;
  post_type: PostType;
  image_url: string | null;
  caption: string | null;
  linked_event_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  club_id: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
}

export interface ConversationChannel {
  id: string;
  conversation_id: string;
  name: string;
  display_order: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  channel_id: string | null;
  sender_id: string;
  content: string | null;
  message_type: MessageType;
  created_at: string;
  updated_at: string;
}

export interface Poll {
  id: string;
  message_id: string;
  question: string;
  allow_multiple: boolean;
  start_at: string | null;
  end_at: string | null;
}

export interface PollOption {
  id: string;
  poll_id: string;
  option_text: string;
  display_order: number;
}

export interface PollVote {
  id: string;
  poll_id: string;
  option_id: string;
  user_id: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  entity_id: string | null;
  entity_type: EntityType | null;
  read: boolean;
  created_at: string;
}

// ---- Helper / Joined Types ------------------------------------

/** Whether two users have a mutual accepted follow (Gluemate status). */
export interface GluemateStatus {
  user_id: string;
  other_user_id: string;
  /** true when both directions of the follow exist with status='accepted' */
  is_gluemate: boolean;
  /** follow from user → other */
  outgoing_follow: Follow | null;
  /** follow from other → user */
  incoming_follow: Follow | null;
}

/** Event row joined with its hosting club's name and avatar. */
export interface EventWithClub extends Event {
  club: Pick<Club, 'id' | 'name' | 'handle' | 'avatar_url'>;
}

/** Club row with a computed member count. */
export interface ClubWithMemberCount extends Club {
  member_count: number;
}

/** Union discriminated type for home feed items. */
export type FeedItem =
  | ({ feed_type: 'post' } & Post)
  | ({ feed_type: 'event' } & EventWithClub);

// ---- Supabase Database shape (for typed client) ---------------

export type Database = {
  public: {
    Tables: {
      profiles:                  { Row: Profile;                  Insert: Omit<Profile, 'created_at' | 'updated_at'>;                  Update: Partial<Omit<Profile, 'id'>>; };
      user_interests:            { Row: UserInterest;             Insert: Omit<UserInterest, 'id'>;                                     Update: Partial<Omit<UserInterest, 'id'>>; };
      user_activities:           { Row: UserActivity;             Insert: Omit<UserActivity, 'id'>;                                     Update: Partial<Omit<UserActivity, 'id'>>; };
      user_privacy:              { Row: UserPrivacy;              Insert: Omit<UserPrivacy, 'id'>;                                      Update: Partial<Omit<UserPrivacy, 'id'>>; };
      follows:                   { Row: Follow;                   Insert: Omit<Follow, 'id' | 'created_at'>;                           Update: Partial<Omit<Follow, 'id'>>; };
      clubs:                     { Row: Club;                     Insert: Omit<Club, 'id' | 'created_at' | 'updated_at'>;              Update: Partial<Omit<Club, 'id'>>; };
      club_goals:                { Row: ClubGoal;                 Insert: Omit<ClubGoal, 'id'>;                                        Update: Partial<Omit<ClubGoal, 'id'>>; };
      club_interests:            { Row: ClubInterest;             Insert: Omit<ClubInterest, 'id'>;                                    Update: Partial<Omit<ClubInterest, 'id'>>; };
      club_members:              { Row: ClubMember;               Insert: Omit<ClubMember, 'id' | 'joined_at'>;                       Update: Partial<Omit<ClubMember, 'id'>>; };
      club_officers:             { Row: ClubOfficer;              Insert: Omit<ClubOfficer, 'id'>;                                     Update: Partial<Omit<ClubOfficer, 'id'>>; };
      club_photos:               { Row: ClubPhoto;                Insert: Omit<ClubPhoto, 'id' | 'created_at'>;                       Update: Partial<Omit<ClubPhoto, 'id'>>; };
      events:                    { Row: Event;                    Insert: Omit<Event, 'id' | 'created_at' | 'updated_at'>;             Update: Partial<Omit<Event, 'id'>>; };
      event_interests:           { Row: EventInterest;            Insert: Omit<EventInterest, 'id'>;                                   Update: Partial<Omit<EventInterest, 'id'>>; };
      event_activities:          { Row: EventActivity;            Insert: Omit<EventActivity, 'id'>;                                   Update: Partial<Omit<EventActivity, 'id'>>; };
      event_rsvps:               { Row: EventRsvp;                Insert: Omit<EventRsvp, 'id' | 'created_at'>;                       Update: Partial<Omit<EventRsvp, 'id'>>; };
      saved_events:              { Row: SavedEvent;               Insert: Omit<SavedEvent, 'id' | 'saved_at'>;                        Update: Partial<Omit<SavedEvent, 'id'>>; };
      posts:                     { Row: Post;                     Insert: Omit<Post, 'id' | 'created_at'>;                            Update: Partial<Omit<Post, 'id'>>; };
      conversations:             { Row: Conversation;             Insert: Omit<Conversation, 'id' | 'created_at'>;                    Update: Partial<Omit<Conversation, 'id'>>; };
      conversation_participants: { Row: ConversationParticipant;  Insert: Omit<ConversationParticipant, 'id' | 'joined_at'>;          Update: Partial<Omit<ConversationParticipant, 'id'>>; };
      conversation_channels:     { Row: ConversationChannel;      Insert: Omit<ConversationChannel, 'id'>;                            Update: Partial<Omit<ConversationChannel, 'id'>>; };
      messages:                  { Row: Message;                  Insert: Omit<Message, 'id' | 'created_at' | 'updated_at'>;         Update: Partial<Omit<Message, 'id'>>; };
      polls:                     { Row: Poll;                     Insert: Omit<Poll, 'id'>;                                           Update: Partial<Omit<Poll, 'id'>>; };
      poll_options:              { Row: PollOption;               Insert: Omit<PollOption, 'id'>;                                     Update: Partial<Omit<PollOption, 'id'>>; };
      poll_votes:                { Row: PollVote;                 Insert: Omit<PollVote, 'id'>;                                       Update: Partial<Omit<PollVote, 'id'>>; };
      notifications:             { Row: Notification;             Insert: Omit<Notification, 'id' | 'created_at'>;                   Update: Partial<Omit<Notification, 'id'>>; };
    };
  };
};
