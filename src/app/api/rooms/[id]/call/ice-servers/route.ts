import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { generateCallIceServers } from '@/lib/services/turnService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
} as const;

/**
 * POST /api/rooms/[id]/call/ice-servers
 *
 * Returns short-lived TURN/STUN ICE configuration strictly for authenticated room
 * members who hold an active slot in the room's 2-person voice call.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: roomId } = await context.params;

  if (!roomId || !UUID_REGEX.test(roomId)) {
    return NextResponse.json(
      { error: 'Invalid room ID.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || user.is_anonymous) {
      return NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    // Verify room existence & membership on the server (RLS-respecting query)
    const { data: memberRow, error: memberError } = await supabase
      .from('room_members')
      .select('id')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .maybeSingle();

    let isAuthorizedMember = Boolean(memberRow);
    if (!isAuthorizedMember && !memberError) {
      const { data: hostedRoom } = await supabase
        .from('rooms')
        .select('id')
        .eq('id', roomId)
        .eq('host_id', user.id)
        .maybeSingle();
      isAuthorizedMember = Boolean(hostedRoom);
    }

    if (memberError) {
      return NextResponse.json(
        { error: 'Failed to verify room membership.' },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    if (!isAuthorizedMember) {
      return NextResponse.json(
        { error: 'Only room members can access voice call servers.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // Verify caller currently holds an active slot in this room's 2-person voice call
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: callSlot, error: callSlotError } = await supabase
      .from('room_call_participants')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .gte('last_heartbeat_at', sixtySecondsAgo)
      .maybeSingle();

    if (callSlotError) {
      return NextResponse.json(
        { error: 'Failed to verify voice call slot.' },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    if (!callSlot) {
      return NextResponse.json(
        { error: 'Join the room voice call before requesting ICE servers.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    // Server-side Postgres rate limit (max 12 requests per 10 minutes per user)
    const { data: withinRateLimit, error: rateLimitError } = await supabase.rpc(
      'check_and_record_call_credential_request',
      { p_room_id: roomId }
    );

    if (rateLimitError) {
      return NextResponse.json(
        { error: 'Failed to check call credential rate limit.' },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    if (!withinRateLimit) {
      return NextResponse.json(
        { error: 'Too many voice credential requests. Please wait a moment and try again.' },
        { status: 429, headers: NO_STORE_HEADERS }
      );
    }

    const result = await generateCallIceServers();
    return NextResponse.json(result, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err: unknown) {
    // Log message without secrets or credentials
    console.error(
      '[Syncora] ICE credential provisioning failed:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return NextResponse.json(
      { error: 'Unable to provision voice relay servers right now.' },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}

