import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Load migration files to inspect and test SQL policy definitions
const schemaSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/001_initial_schema.sql'),
  'utf-8'
);
const storageSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/002_storage_and_replica.sql'),
  'utf-8'
);

describe('Syncora Security Architecture & Policy Audit', () => {
  it('1. Impersonation Prevention: Ensures users cannot insert or update records as another identity', () => {
    // Profiles check: Users can only insert/update matching auth.uid()
    assert.match(
      schemaSql,
      /CREATE POLICY "Users can insert their own profile"[\s\S]*?WITH CHECK \(auth\.uid\(\) = id\)/,
      'Profiles INSERT must require auth.uid() = id'
    );
    assert.match(
      schemaSql,
      /CREATE POLICY "Users can update their own profile"[\s\S]*?USING \(auth\.uid\(\) = id\)/,
      'Profiles UPDATE must require auth.uid() = id'
    );

    // Chat messages check: Sender must match auth.uid()
    assert.match(
      schemaSql,
      /CREATE POLICY "Active room members can insert messages"[\s\S]*?auth\.uid\(\) = user_id/,
      'Chat messages INSERT must verify auth.uid() = user_id to prevent impersonation'
    );
  });

  it('2. Unauthorized Room Access: Protects private rooms from table scanning and eavesdropping', () => {
    // Rooms SELECT policy must require membership or host authority for private rooms
    assert.match(
      schemaSql,
      /CREATE POLICY "Rooms are viewable by members or host"[\s\S]*?NOT is_private[\s\S]*?host_id = auth\.uid\(\)[\s\S]*?(?:EXISTS \([\s\S]*?room_members[\s\S]*?user_id = auth\.uid\(\)|is_room_member\(id, auth\.uid\(\)\))/,
      'Private rooms must be hidden from non-members and uninvited users'
    );

    // Uninvited users cannot list all rooms; they must use the secure RPC with the exact room code
    assert.match(
      schemaSql,
      /CREATE OR REPLACE FUNCTION public\.lookup_room_by_code\(p_code TEXT\)/,
      'lookup_room_by_code RPC must be defined for safe code-based entry'
    );
  });

  it('3. Message Injection Prevention: Users cannot inject chat into rooms they have not joined', () => {
    // Chat messages must verify room membership
    assert.match(
      schemaSql,
      /CREATE POLICY "Active room members can insert messages"[\s\S]*?(?:EXISTS \([\s\S]*?FROM public\.room_members[\s\S]*?WHERE room_members\.room_id = chat_messages\.room_id[\s\S]*?AND room_members\.user_id = auth\.uid\(\)|is_room_member\(room_id, auth\.uid\(\)\))/,
      'Chat insertion must strictly enforce room membership'
    );

    // Reading chat messages requires active room membership
    assert.match(
      schemaSql,
      /CREATE POLICY "Room members can read chat messages"[\s\S]*?(?:EXISTS \([\s\S]*?FROM public\.room_members[\s\S]*?WHERE room_members\.room_id = chat_messages\.room_id[\s\S]*?AND room_members\.user_id = auth\.uid\(\)|is_room_member\(room_id, auth\.uid\(\)\))/,
      'Chat reading must strictly enforce room membership'
    );
  });

  it('4. Privilege Escalation Prevention: Viewers cannot promote themselves to host or mutate playback', () => {
    // Room members INSERT must restrict role='host' to actual room host
    assert.match(
      schemaSql,
      /role = 'viewer'[\s\S]*?OR \(role = 'host' AND (?:auth\.uid\(\) = \(SELECT host_id FROM public\.rooms WHERE id = room_id\)|public\.is_room_host\(room_id, auth\.uid\(\)\))\)/,
      'Joining users cannot arbitrarily assign themselves the host role'
    );

    // Playback mutation in rooms UPDATE must require host or co-host role
    assert.match(
      schemaSql,
      /CREATE POLICY "Host and co-hosts can update room playback"[\s\S]*?auth\.uid\(\) = host_id[\s\S]*?(?:role IN \('host', 'co-host'\)|public\.is_room_host_or_cohost\(id, auth\.uid\(\)\))/,
      'Only host or co-host can update playback position and video source'
    );
  });

  it('5. Storage Security: Videos bucket is private and strictly room-scoped with signed URLs', () => {
    // Bucket must be private
    assert.match(
      storageSql,
      /INSERT INTO storage\.buckets[\s\S]*?'videos',[\s\S]*?false,[\s\S]*?52428800/,
      'Videos bucket must be private (public = false) and capped at 50MB'
    );

    // Upload policy must require host or co-host of that specific room
    assert.match(
      storageSql,
      /CREATE POLICY "Room hosts and co-hosts can upload video"[\s\S]*?(?:role IN \('host', 'co-host'\)|public\.is_room_host_or_cohost\()/ ,
      'Storage uploads must be restricted to host/co-host of the room UUID path'
    );

    // Read policy must require room membership
    assert.match(
      storageSql,
      /CREATE POLICY "Room members can read video files via signed URL"[\s\S]*?(?:EXISTS \([\s\S]*?public\.room_members|public\.is_room_member\()/ ,
      'Storage reads must require active room membership'
    );
  });

  it('6. Abuse Prevention: Rate limiting triggers protect rooms and chat', () => {
    assert.match(
      schemaSql,
      /tr_check_room_creation_rate/,
      'Room creation rate limiting trigger must be active'
    );
    assert.match(
      schemaSql,
      /tr_check_chat_message_rate/,
      'Chat message rate limiting trigger must be active'
    );
  });

  it('7. Phase 10.1 Hardening: Private Realtime channels, server-side capacity, escalation & function guards', () => {
    const hardeningSql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/005_realtime_authorization_and_membership_hardening.sql'),
      'utf-8'
    );
    const fullSetupSql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/full_setup.sql'),
      'utf-8'
    );
    const useRoomCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useRoom.ts'),
      'utf-8'
    );
    const useChatCode = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useChat.ts'),
      'utf-8'
    );

    assert.match(
      hardeningSql,
      /CREATE POLICY "syncora_room_members_can_receive"[\s\S]*?ON realtime\.messages[\s\S]*?FOR SELECT[\s\S]*?can_access_room_topic/,
      '005 migration must define strict SELECT policy on realtime.messages'
    );
    assert.match(
      hardeningSql,
      /CREATE POLICY "syncora_room_members_can_send"[\s\S]*?ON realtime\.messages[\s\S]*?FOR INSERT[\s\S]*?can_access_room_topic/,
      '005 migration must define strict INSERT policy on realtime.messages'
    );
    assert.match(
      hardeningSql,
      /DROP POLICY IF EXISTS "Members can receive realtime room messages" ON realtime\.messages/,
      '005 migration must drop legacy 002 permissive realtime policies'
    );
    assert.match(
      hardeningSql,
      /tr_enforce_room_member_capacity[\s\S]*?BEFORE INSERT ON public\.room_members/,
      '005 migration must enforce 4-member room capacity via BEFORE INSERT trigger'
    );
    assert.match(
      hardeningSql,
      /pg_advisory_xact_lock/,
      '005 capacity trigger must serialize concurrent joins with advisory lock'
    );
    assert.match(
      hardeningSql,
      /tr_guard_room_member_update[\s\S]*?BEFORE UPDATE ON public\.room_members/,
      '005 migration must prevent room_members role/room_id escalation'
    );
    assert.match(
      hardeningSql,
      /REVOKE EXECUTE ON FUNCTION public\.lookup_room_by_code\(TEXT\) FROM PUBLIC, anon/,
      '005 migration must revoke anon execution on lookup_room_by_code'
    );
    assert.match(
      fullSetupSql,
      /syncora_room_members_can_receive/,
      'full_setup.sql must mirror Phase 10.1 Realtime authorization policies'
    );

    // Client channels must opt into private mode and refresh Realtime JWT before subscribe
    assert.match(
      useRoomCode,
      /supabase\.channel\(channelName,\s*\{\s*config:\s*\{\s*private:\s*true\s*\}\s*\}\)/,
      'useRoom must configure room channel as private: true'
    );
    assert.match(
      useRoomCode,
      /supabase\.realtime\.setAuth\(/,
      'useRoom must attach authenticated JWT via supabase.realtime.setAuth()'
    );
    assert.match(
      useChatCode,
      /supabase\.channel\(`room_chat:\$\{roomId\}`,\s*\{\s*config:\s*\{\s*private:\s*true\s*\}\s*,?\s*\}\)/,
      'useChat fallback channel must configure private: true'
    );
  });
});

