import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: roomId } = await context.params;

  if (!roomId || !UUID_REGEX.test(roomId)) {
    return NextResponse.json({ error: 'Invalid room ID.' }, { status: 400 });
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

    let adminOrUserClient = supabase;
    try {
      adminOrUserClient = getSupabaseAdminClient();
    } catch {
      // Fallback to authenticated host client when SUPABASE_SECRET_KEY is not configured
    }

    // Verify room existence, host ownership, and query storage usage concurrently
    const [roomResult, metricsResult] = await Promise.all([
      supabase
        .from('rooms')
        .select('id, host_id, video_type')
        .eq('id', roomId)
        .maybeSingle(),
      adminOrUserClient
        .from('storage_usage_metrics')
        .select('file_path')
        .eq('room_id', roomId)
        .eq('is_deleted', false),
    ]);

    if (roomResult.error) {
      return NextResponse.json({ error: roomResult.error.message }, { status: 500 });
    }

    const room = roomResult.data;
    if (!room) {
      return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    }

    if (room.host_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the room host can delete this room.' },
        { status: 403 }
      );
    }

    // 1. Identify any uploaded video files scoped to this room
    const metricRows = metricsResult.data;
    const pathsToRemove = new Set<string>();

    if (Array.isArray(metricRows)) {
      for (const row of metricRows) {
        if (row.file_path) {
          pathsToRemove.add(row.file_path);
        }
      }
    }

    // Only invoke slow Storage API if the room used an upload and no paths were in metrics
    if (room.video_type === 'upload' && pathsToRemove.size === 0) {
      const { data: listedObjects } = await adminOrUserClient.storage
        .from('videos')
        .list(roomId, { limit: 100 });

      if (Array.isArray(listedObjects)) {
        for (const obj of listedObjects) {
          if (obj.name && obj.id !== null) {
            pathsToRemove.add(`${roomId}/${obj.name}`);
          }
        }
      }
    }

    // 2. Delete video objects in Storage if any exist
    if (pathsToRemove.size > 0) {
      const { error: removeStorageError } = await adminOrUserClient.storage
        .from('videos')
        .remove(Array.from(pathsToRemove));

      if (removeStorageError) {
        return NextResponse.json(
          { error: `Failed to remove uploaded room video: ${removeStorageError.message}` },
          { status: 500 }
        );
      }
    }

    // 3. Mark storage usage metrics as deleted only if metric rows existed
    if (Array.isArray(metricRows) && metricRows.length > 0) {
      await adminOrUserClient
        .from('storage_usage_metrics')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
        })
        .eq('room_id', roomId)
        .eq('is_deleted', false);
    }

    // 4. Delete the room (cascades cleanly to room_members, chat_messages, queue, etc.)
    const { error: deleteRoomError } = await adminOrUserClient
      .from('rooms')
      .delete()
      .eq('id', roomId)
      .eq('host_id', user.id);

    if (deleteRoomError) {
      return NextResponse.json({ error: deleteRoomError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletedVideoFiles: pathsToRemove.size,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete room.' },
      { status: 500 }
    );
  }
}

