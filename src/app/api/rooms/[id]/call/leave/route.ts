import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
} as const;

/**
 * POST /api/rooms/[id]/call/leave
 *
 * Beacon-friendly endpoint used on `pagehide` / tab close so the caller's slot
 * in `room_call_participants` is released immediately instead of waiting for TTL expiry.
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

    const { error: leaveError } = await supabase.rpc('leave_room_call', {
      p_room_id: roomId,
    });

    if (leaveError) {
      return NextResponse.json(
        { error: 'Failed to release voice call slot.' },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json({ success: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Failed to release voice call slot.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

