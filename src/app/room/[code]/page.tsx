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
  const title = typeof resolvedSearchParams.title === 'string' ? resolvedSearchParams.title : undefined;

  return <RoomView roomCode={roomCode} initialVideoId={videoId} initialTitle={title} />;
}

export default function RoomPage(props: RoomPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-[#0E281F] text-[#CDBF9F]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#E8DDC5]/20 border-t-[#9670FF] rounded-full animate-spin" />
            <p className="text-[11px] font-mono uppercase tracking-[0.16em]">
              Entering Screening Room...
            </p>
          </div>
        </div>
      }
    >
      <RoomContent {...props} />
    </Suspense>
  );
}
