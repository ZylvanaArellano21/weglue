export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          id: boolean
          launch_university_id: string | null
          single_campus_mode: boolean
          updated_at: string
        }
        Insert: {
          id?: boolean
          launch_university_id?: string | null
          single_campus_mode?: boolean
          updated_at?: string
        }
        Update: {
          id?: boolean
          launch_university_id?: string | null
          single_campus_mode?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_config_launch_university_id_fkey"
            columns: ["launch_university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      club_categories: {
        Row: {
          category: string
          club_id: string
          id: string
        }
        Insert: {
          category: string
          club_id: string
          id?: string
        }
        Update: {
          category?: string
          club_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_categories_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_goals: {
        Row: {
          club_id: string
          display_order: number
          goal_text: string
          id: string
        }
        Insert: {
          club_id: string
          display_order?: number
          goal_text: string
          id?: string
        }
        Update: {
          club_id?: string
          display_order?: number
          goal_text?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_goals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_interests: {
        Row: {
          club_id: string
          id: string
          interest: string | null
          interest_id: string
          tier: string
        }
        Insert: {
          club_id: string
          id?: string
          interest?: string | null
          interest_id: string
          tier: string
        }
        Update: {
          club_id?: string
          id?: string
          interest?: string | null
          interest_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_interests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_interests_interest_id_fkey"
            columns: ["interest_id"]
            isOneToOne: false
            referencedRelation: "interests"
            referencedColumns: ["id"]
          },
        ]
      }
      club_members: {
        Row: {
          club_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          club_id: string
          id?: string
          joined_at?: string
          role: string
          user_id: string
        }
        Update: {
          club_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club_officers: {
        Row: {
          avatar_url: string | null
          club_id: string
          display_name: string
          display_order: number
          id: string
          role_title: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          club_id: string
          display_name: string
          display_order?: number
          id?: string
          role_title: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          club_id?: string
          display_name?: string
          display_order?: number
          id?: string
          role_title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_officers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_officers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club_photos: {
        Row: {
          caption: string | null
          club_id: string
          created_at: string
          id: string
          is_visible: boolean
          post_id: string | null
          source: string | null
          uploaded_by: string | null
          url: string
        }
        Insert: {
          caption?: string | null
          club_id: string
          created_at?: string
          id?: string
          is_visible?: boolean
          post_id?: string | null
          source?: string | null
          uploaded_by?: string | null
          url: string
        }
        Update: {
          caption?: string | null
          club_id?: string
          created_at?: string
          id?: string
          is_visible?: boolean
          post_id?: string | null
          source?: string | null
          uploaded_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_photos_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_photos_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          avatar_url: string | null
          banner_url: string | null
          claimed: boolean
          cover_image_url: string | null
          created_at: string
          description: string
          handle: string
          id: string
          inactivity_warned_at: string | null
          is_active: boolean
          is_seed: boolean
          last_activity_at: string | null
          meeting_building: string | null
          meeting_day: string | null
          meeting_location: string | null
          meeting_room: string | null
          meeting_time_end: string | null
          meeting_time_start: string | null
          member_count: number
          name: string
          university: string | null
          updated_at: string
          university_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          banner_url?: string | null
          claimed?: boolean
          cover_image_url?: string | null
          created_at?: string
          description: string
          handle: string
          id?: string
          inactivity_warned_at?: string | null
          is_active?: boolean
          is_seed?: boolean
          last_activity_at?: string | null
          meeting_building?: string | null
          meeting_day?: string | null
          meeting_location?: string | null
          meeting_room?: string | null
          meeting_time_end?: string | null
          meeting_time_start?: string | null
          member_count?: number
          name: string
          university?: string | null
          updated_at?: string
          university_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          banner_url?: string | null
          claimed?: boolean
          cover_image_url?: string | null
          created_at?: string
          description?: string
          handle?: string
          id?: string
          inactivity_warned_at?: string | null
          is_active?: boolean
          is_seed?: boolean
          last_activity_at?: string | null
          meeting_building?: string | null
          meeting_day?: string | null
          meeting_location?: string | null
          meeting_room?: string | null
          meeting_time_end?: string | null
          meeting_time_start?: string | null
          member_count?: number
          name?: string
          university?: string | null
          updated_at?: string
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clubs_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_channels: {
        Row: {
          conversation_id: string
          created_by: string | null
          display_order: number
          id: string
          is_default: boolean
          is_restricted: boolean
          name: string
        }
        Insert: {
          conversation_id: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_default?: boolean
          is_restricted?: boolean
          name: string
        }
        Update: {
          conversation_id?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_default?: boolean
          is_restricted?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_channels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          id: string
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          avatar_url: string | null
          club_id: string | null
          created_at: string
          id: string
          name: string | null
          type: string
        }
        Insert: {
          avatar_url?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          name?: string | null
          type: string
        }
        Update: {
          avatar_url?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          name?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      event_activities: {
        Row: {
          activity: string
          event_id: string
          id: string
        }
        Insert: {
          activity: string
          event_id: string
          id?: string
        }
        Update: {
          activity?: string
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_activities_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_images: {
        Row: {
          created_at: string
          event_id: string
          height: number | null
          id: string
          position: number
          storage_path: string
          width: number | null
        }
        Insert: {
          created_at?: string
          event_id: string
          height?: number | null
          id?: string
          position: number
          storage_path: string
          width?: number | null
        }
        Update: {
          created_at?: string
          event_id?: string
          height?: number | null
          id?: string
          position?: number
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_images_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_interests: {
        Row: {
          event_id: string
          id: string
          interest: string
        }
        Insert: {
          event_id: string
          id?: string
          interest: string
        }
        Update: {
          event_id?: string
          id?: string
          interest?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_interests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          building: string | null
          club_id: string
          cover_image_url: string | null
          created_at: string
          created_by: string
          description: string | null
          emoji: string | null
          end_time: string
          event_date: string
          id: string
          is_seed: boolean
          location: string | null
          room: string | null
          specific_user_ids: string[] | null
          start_time: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          building?: string | null
          club_id: string
          cover_image_url?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          emoji?: string | null
          end_time: string
          event_date: string
          id?: string
          is_seed?: boolean
          location?: string | null
          room?: string | null
          specific_user_ids?: string[] | null
          start_time: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          building?: string | null
          club_id?: string
          cover_image_url?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          emoji?: string | null
          end_time?: string
          event_date?: string
          id?: string
          is_seed?: boolean
          location?: string | null
          room?: string | null
          specific_user_ids?: string[] | null
          start_time?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
          status: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interests: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_active: boolean
          label: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_url: string | null
          channel_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          message_type: string
          reply_to_id: string | null
          sender_id: string
          updated_at: string
        }
        Insert: {
          attachment_url?: string | null
          channel_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          message_type?: string
          reply_to_id?: string | null
          sender_id: string
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          channel_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          message_type?: string
          reply_to_id?: string | null
          sender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "conversation_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          read: boolean
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          read?: boolean
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          read?: boolean
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_options: {
        Row: {
          display_order: number
          id: string
          option_text: string
          poll_id: string
        }
        Insert: {
          display_order: number
          id?: string
          option_text: string
          poll_id: string
        }
        Update: {
          display_order?: number
          id?: string
          option_text?: string
          poll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          allow_multiple: boolean
          end_at: string | null
          id: string
          message_id: string
          question: string
          start_at: string | null
        }
        Insert: {
          allow_multiple?: boolean
          end_at?: string | null
          id?: string
          message_id: string
          question: string
          start_at?: string | null
        }
        Update: {
          allow_multiple?: boolean
          end_at?: string | null
          id?: string
          message_id?: string
          question?: string
          start_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "polls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      post_club_tags: {
        Row: {
          club_id: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_club_tags_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_club_tags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          parent_comment_id: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          caption: string | null
          club_id: string | null
          created_at: string
          id: string
          image_url: string | null
          linked_event_id: string | null
          post_type: string
        }
        Insert: {
          author_id: string
          caption?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          linked_event_id?: string | null
          post_type: string
        }
        Update: {
          author_id?: string
          caption?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          linked_event_id?: string | null
          post_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agreed_at: string | null
          agreed_to_terms: boolean
          avatar_type: string | null
          avatar_url: string | null
          bio: string | null
          created_at: string
          email_verified: boolean
          full_name: string
          id: string
          is_seed: boolean
          major: string | null
          onboarding_complete: boolean
          university: string | null
          updated_at: string
          university_id: string | null
          username: string
          year: string | null
        }
        Insert: {
          agreed_at?: string | null
          agreed_to_terms?: boolean
          avatar_type?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email_verified?: boolean
          full_name: string
          id: string
          is_seed?: boolean
          major?: string | null
          onboarding_complete?: boolean
          university?: string | null
          updated_at?: string
          university_id?: string | null
          username: string
          year?: string | null
        }
        Update: {
          agreed_at?: string | null
          agreed_to_terms?: boolean
          avatar_type?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email_verified?: boolean
          full_name?: string
          id?: string
          is_seed?: boolean
          major?: string | null
          onboarding_complete?: boolean
          university?: string | null
          updated_at?: string
          university_id?: string | null
          username?: string
          year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_events: {
        Row: {
          event_id: string
          id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          saved_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activities: {
        Row: {
          activity: string
          id: string
          user_id: string
        }
        Insert: {
          activity: string
          id?: string
          user_id: string
        }
        Update: {
          activity?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_interests: {
        Row: {
          id: string
          interest: string | null
          interest_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          interest?: string | null
          interest_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          interest?: string | null
          interest_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_interests_interest_id_fkey"
            columns: ["interest_id"]
            isOneToOne: false
            referencedRelation: "interests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_interests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_privacy: {
        Row: {
          hide_events: boolean
          hide_interests: boolean
          id: string
          is_private: boolean
          user_id: string
        }
        Insert: {
          hide_events?: boolean
          hide_interests?: boolean
          id?: string
          is_private?: boolean
          user_id: string
        }
        Update: {
          hide_events?: boolean
          hide_interests?: boolean
          id?: string
          is_private?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_privacy_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      universities: {
        Row: {
          created_at: string
          email_denied_message: string | null
          email_domains: string[] | null
          email_mode: string
          id: string
          is_active: boolean
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          email_denied_message?: string | null
          email_domains?: string[] | null
          email_mode?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          email_denied_message?: string | null
          email_domains?: string[] | null
          email_mode?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_tx_club_create: {
        Args: {
          p_actor_email: string
          p_actor_id: string
          p_avatar_url?: string
          p_banner_url?: string
          p_correlation_id: string
          p_cover_image_url?: string
          p_description?: string
          p_handle?: string
          p_meeting_building?: string
          p_meeting_day?: string
          p_meeting_location?: string
          p_meeting_room?: string
          p_meeting_schedule?: Json
          p_meeting_time_end?: string
          p_meeting_time_start?: string
          p_name: string
          p_reason?: string
          p_university_id?: string
        }
        Returns: Json
      }
      admin_tx_club_update: {
        Args: {
          p_actor_email: string
          p_actor_id: string
          p_club_id: string
          p_correlation_id: string
          p_patch: Json
          p_reason?: string
        }
        Returns: Json
      }
      before_user_created: { Args: { event: Json }; Returns: Json }
      campus_email_allowed: {
        Args: { p_email: string; p_university_id: string }
        Returns: boolean
      }
      cast_poll_vote: {
        Args: { p_option_id: string; p_poll_id: string }
        Returns: undefined
      }
      check_club_inactivity: { Args: never; Returns: undefined }
      get_phone_discovery_categories: {
        Args: never
        Returns: {
          label: string
          slug: string
          sort_order: number
        }[]
      }
      get_phone_discovery_clubs: {
        Args: {
          p_interest_slug?: string
          p_limit?: number
          p_offset?: number
          p_user_id: string
        }
        Returns: {
          avatar_url: string
          categories: string[]
          cover_image_url: string
          id: string
          is_member: boolean
          meeting_building: string
          meeting_day: string
          meeting_room: string
          meeting_time_end: string
          meeting_time_start: string
          member_count: number
          name: string
        }[]
      }
      set_my_interests: { Args: { p_slugs: string[] }; Returns: undefined }
      get_discovery_clubs: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_user_id: string
        }
        Returns: {
          avatar_url: string
          categories: string[]
          cover_image_url: string
          id: string
          is_member: boolean
          meeting_building: string
          meeting_day: string
          meeting_room: string
          meeting_time_end: string
          meeting_time_start: string
          member_count: number
          name: string
        }[]
      }
      get_discovery_people: {
        Args: { p_user_id: string }
        Returns: {
          avatar_url: string
          club_id: string
          club_name: string
          full_name: string
          user_id: string
          username: string
        }[]
      }
      get_or_create_direct_chat: {
        Args: { other_user_id: string }
        Returns: string
      }
      get_public_club_media: {
        Args: { p_after?: string; p_club_id: string; p_limit?: number }
        Returns: Json
      }
      get_public_club_past_events: {
        Args: { p_after?: string; p_club_id: string; p_limit?: number }
        Returns: Json
      }
      get_public_club_posts: {
        Args: { p_after?: string; p_club_id: string; p_limit?: number }
        Returns: Json
      }
      get_public_club_profile: { Args: { p_club_id: string }; Returns: Json }
      get_public_club_upcoming_events: {
        Args: { p_after?: string; p_club_id: string; p_limit?: number }
        Returns: Json
      }
      insert_event_images_with_dimensions: {
        Args: {
          p_event_id: string
          p_image_dimensions: Json
          p_image_paths: string[]
        }
        Returns: undefined
      }
      is_channel_club_officer: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      is_club_member: { Args: { p_club_id: string }; Returns: boolean }
      is_club_officer: { Args: { p_club_id: string }; Returns: boolean }
      is_conversation_participant: {
        Args: { p_conv_id: string }
        Returns: boolean
      }
      is_educational_email: { Args: { email: string }; Returns: boolean }
      list_active_campuses: {
        Args: never
        Returns: {
          email_denied_message: string | null
          email_domains: string[] | null
          email_mode: string
          name: string
          slug: string
        }[]
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      search_discovery: {
        Args: { p_query: string; p_user_id: string }
        Returns: {
          avatar_url: string
          id: string
          is_member: boolean
          name: string
          result_type: string
          sub: string
        }[]
      }
      search_event_audience_members: {
        Args: { p_club_id: string; p_limit?: number; p_query?: string }
        Returns: {
          avatar_url: string
          club_role: string
          full_name: string
          id: string
          is_officer: boolean
          username: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
