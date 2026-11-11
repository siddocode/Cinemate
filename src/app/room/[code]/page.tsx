import React, { Suspense } from 'react';
import { RoomView } from '@/components/room/RoomView';

interface RoomPageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function RoomContent({ params, searchParams }: RoomPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const roomCode = resolvedParams.code;
  const videoId = typeof resolvedSearchParams.v === 'string' ? resolvedSearchParams.v : undefined;

  return <RoomView roomCode={roomCode} initialVideoId={videoId} />;
}

export default function RoomPage(props: RoomPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-[#090a0f] text-neutral-400">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs">Entering Watch Room...</p>
          </div>
        </div>
      }
    >
      <RoomContent {...props} />
    </Suspense>
  );
}
