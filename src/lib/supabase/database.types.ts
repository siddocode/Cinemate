export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          avatar_url: string | null;
          is_guest: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          avatar_url?: string | null;
          is_guest?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          avatar_url?: string | null;
          is_guest?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          code: string;
          title: string;
          host_id: string;
          video_type: 'youtube' | 'url' | 'upload';
          video_url: string;
          current_position: number;
          is_playing: boolean;
          last_synced_at: string;
          is_private: boolean;
          passcode_hash: string | null;
          closed_at?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          host_id: string;
          video_type: 'youtube' | 'url' | 'upload';
          video_url: string;
          current_position?: number;
          is_playing?: boolean;
          last_synced_at?: string;
          is_private?: boolean;
          passcode_hash?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          title?: string;
          host_id?: string;
          video_type?: 'youtube' | 'url' | 'upload';
          video_url?: string;
          current_position?: number;
          is_playing?: boolean;
          last_synced_at?: string;
          is_private?: boolean;
          passcode_hash?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rooms_host_id_fkey';
            columns: ['host_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      room_members: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          role: 'host' | 'co-host' | 'viewer';
          joined_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          role?: 'host' | 'co-host' | 'viewer';
          joined_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_id?: string;
          role?: 'host' | 'co-host' | 'viewer';
          joined_at?: string;
          last_seen_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_members_room_id_fkey';
            columns: ['room_id'];
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'room_members_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          content: string;
          type: 'chat' | 'system';
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          content: string;
          type?: 'chat' | 'system';
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_id?: string;
          content?: string;
          type?: 'chat' | 'system';
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_messages_room_id_fkey';
            columns: ['room_id'];
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chat_messages_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      storage_usage_metrics: {
        Row: {
          id: string;
          room_id: string | null;
          user_id: string | null;
          file_path: string;
          file_size_bytes: number;
          estimated_egress_bytes: number;
          is_deleted: boolean;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          room_id?: string | null;
          user_id?: string | null;
          file_path: string;
          file_size_bytes: number;
          estimated_egress_bytes?: number;
          is_deleted?: boolean;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          room_id?: string | null;
          user_id?: string | null;
          file_path?: string;
          file_size_bytes?: number;
          estimated_egress_bytes?: number;
          is_deleted?: boolean;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'storage_usage_metrics_room_id_fkey';
            columns: ['room_id'];
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'storage_usage_metrics_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      user_favorites: {
        Row: {
          id: string;
          user_id: string;
          room_code: string | null;
          video_id: string;
          video_title: string;
          thumbnail_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          room_code?: string | null;
          video_id: string;
          video_title: string;
          thumbnail_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          room_code?: string | null;
          video_id?: string;
          video_title?: string;
          thumbnail_url?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_favorites_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      room_call_participants: {
        Row: {
          room_id: string;
          user_id: string;
          call_session_id: string;
          joined_at: string;
          last_heartbeat_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          call_session_id?: string;
          joined_at?: string;
          last_heartbeat_at?: string;
        };
        Update: {
          room_id?: string;
          user_id?: string;
          call_session_id?: string;
          joined_at?: string;
          last_heartbeat_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_call_participants_room_id_fkey';
            columns: ['room_id'];
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'room_call_participants_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      lookup_room_by_code: {
        Args: {
          p_code: string;
        };
        Returns: Database['public']['Tables']['rooms']['Row'][];
      };
      increment_video_egress: {
        Args: {
          p_file_path: string;
          p_bytes: number;
        };
        Returns: void;
      };
      join_room_call: {
        Args: {
          p_room_id: string;
        };
        Returns: Database['public']['Tables']['room_call_participants']['Row'][];
      };
      heartbeat_room_call: {
        Args: {
          p_room_id: string;
        };
        Returns: boolean;
      };
      leave_room_call: {
        Args: {
          p_room_id: string;
        };
        Returns: void;
      };
      check_and_record_call_credential_request: {
        Args: {
          p_room_id: string;
          p_max_requests?: number;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

