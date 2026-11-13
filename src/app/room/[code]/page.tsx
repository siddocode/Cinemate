import React, { Suspense } from 'react';
import { RoomView } from '@/components/room/RoomView';
import { RoomLoadingState } from '@/components/room/RoomLoadingState';

interface RoomPageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function RoomContent({ params, searchParams }: RoomPageProps) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  const roomCode = resolvedParams.code;
  const source = resolvedSearchParams.source;
  const initialVideoType =
    source === 'url' || source === 'upload' || source === 'youtube'
      ? source
      : 'youtube';
  const videoId =
    typeof resolvedSearchParams.v === 'string'
      ? resolvedSearchParams.v
      : typeof resolvedSearchParams.video === 'string'
      ? resolvedSearchParams.video
      : undefined;
  const title = typeof resolvedSearchParams.title === 'string' ? resolvedSearchParams.title : undefined;
  const allowCreate = resolvedSearchParams.create === '1';
  const seedQueue = resolvedSearchParams.seedQueue === '1';
  const openUpload = resolvedSearchParams.openUpload === '1';

  return (
    <RoomView
      roomCode={roomCode}
      initialVideoId={videoId}
      initialTitle={title}
      allowCreate={allowCreate}
      initialVideoType={initialVideoType}
      seedQueue={seedQueue}
      openUpload={openUpload}
    />
  );
}

export default function RoomPage(props: RoomPageProps) {
  return (
    <Suspense fallback={<RoomLoadingState mode="join" />}>
      <RoomContent {...props} />
    </Suspense>
  );
}
