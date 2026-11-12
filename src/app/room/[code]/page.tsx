import React, { Suspense } from 'react';
import { RoomView } from '@/components/room/RoomView';
import { RoomLoadingState } from '@/components/room/RoomLoadingState';

interface RoomPageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function RoomContent({ params, searchParams }: RoomPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const roomCode = resolvedParams.code;
  const videoId = typeof resolvedSearchParams.v === 'string' ? resolvedSearchParams.v : undefined;
  const title = typeof resolvedSearchParams.title === 'string' ? resolvedSearchParams.title : undefined;
  const allowCreate = resolvedSearchParams.create === '1';

  return (
    <RoomView
      roomCode={roomCode}
      initialVideoId={videoId}
      initialTitle={title}
      allowCreate={allowCreate}
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
