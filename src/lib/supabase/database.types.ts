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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

