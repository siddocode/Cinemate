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

    // Verify room existence and host ownership on the server
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, host_id')
      .eq('id', roomId)
      .maybeSingle();

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }

    if (!room) {
      return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    }

    if (room.host_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the room host can delete this room.' },
        { status: 403 }
      );
    }

    let adminOrUserClient = supabase;
    try {
      adminOrUserClient = getSupabaseAdminClient();
    } catch {
      // Fallback to authenticated host client when SUPABASE_SECRET_KEY is not configured
    }

    // 1. Collect all uploaded video files scoped to this room in Supabase Storage
    const pathsToRemove = new Set<string>();

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

    const { data: metricRows } = await adminOrUserClient
      .from('storage_usage_metrics')
      .select('file_path')
      .eq('room_id', roomId)
      .eq('is_deleted', false);

    if (Array.isArray(metricRows)) {
      for (const row of metricRows) {
        if (row.file_path) {
          pathsToRemove.add(row.file_path);
        }
      }
    }

    // 2. Delete video objects BEFORE deleting the room row (also satisfies host storage RLS)
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

    // 3. Mark storage usage metrics as deleted so active upload quotas update immediately
    await adminOrUserClient
      .from('storage_usage_metrics')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .eq('is_deleted', false);

    // 4. Delete the room (cascades to room_members and chat_messages)
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

