import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/rooms/[id]/video
 * Cleans up uploaded video files scoped to a room when switching to a new video source
 * or replacing a personal upload, preventing orphan storage objects and resetting room quota.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: roomId } = await context.params;

  if (!roomId || !UUID_REGEX.test(roomId)) {
    return NextResponse.json({ error: 'Invalid room ID.' }, { status: 400 });
  }

  let excludePath: string | null = null;
  try {
    const body = (await req.json().catch(() => null)) as { excludePath?: string } | null;
    if (body && typeof body.excludePath === 'string') {
      excludePath = body.excludePath;
    }
  } catch {
    // Optional body
  }

  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || user.is_anonymous) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, host_id, allow_guest_control')
      .eq('id', roomId)
      .maybeSingle();

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }

    if (!room) {
      return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    }

    let isAuthorized = room.host_id === user.id;
    if (!isAuthorized) {
      const { data: membership } = await supabase
        .from('room_members')
        .select('role')
        .eq('room_id', roomId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (membership && (membership.role === 'co-host' || room.allow_guest_control)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Only the room host or authorized controllers can clean up room videos.' },
        { status: 403 }
      );
    }

    let adminOrUserClient = supabase;
    try {
      adminOrUserClient = getSupabaseAdminClient();
    } catch {
      // Fallback to user client when SUPABASE_SECRET_KEY is absent in local dev
    }

    const pathsToRemove = new Set<string>();

    const { data: listedObjects } = await adminOrUserClient.storage
      .from('videos')
      .list(roomId, { limit: 100 });

    if (Array.isArray(listedObjects)) {
      for (const obj of listedObjects) {
        if (obj.name && obj.id !== null) {
          const fullPath = `${roomId}/${obj.name}`;
          if (fullPath !== excludePath) {
            pathsToRemove.add(fullPath);
          }
        }
      }
    }

    const { data: metricRows } = await adminOrUserClient
      .from('storage_usage_metrics')
      .select('file_path')
      .eq('room_id', roomId)
      .eq('is_deleted', false);

    if (Array.isArray(metricRows)) {
      for (const row of metricRows) {
        if (row.file_path && row.file_path !== excludePath) {
          pathsToRemove.add(row.file_path);
        }
      }
    }

    if (pathsToRemove.size > 0) {
      await adminOrUserClient.storage
        .from('videos')
        .remove(Array.from(pathsToRemove));

      let metricsQuery = adminOrUserClient
        .from('storage_usage_metrics')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('room_id', roomId)
        .eq('is_deleted', false);

      if (excludePath) {
        metricsQuery = metricsQuery.neq('file_path', excludePath);
      }

      await metricsQuery;
    }

    return NextResponse.json({
      deletedCount: pathsToRemove.size,
      deletedPaths: Array.from(pathsToRemove),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to clean up room video.' },
      { status: 500 }
    );
  }
}

