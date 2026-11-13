'use client';

import React, { useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { YouTubeBrowser } from '@/components/youtube/YouTubeBrowser';
import { YouTubeVideoSummary } from '@/core/types/youtube.types';

interface YouTubeQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (videos: YouTubeVideoSummary[]) => Promise<void> | void;
}

export const YouTubeQueueModal: React.FC<YouTubeQueueModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  if (!isOpen) return null;
  return <YouTubeQueueModalContent onClose={onClose} onAdd={onAdd} />;
};

const YouTubeQueueModalContent: React.FC<Omit<YouTubeQueueModalProps, 'isOpen'>> = ({
  onClose,
  onAdd,
}) => {
  const [selected, setSelected] = useState<YouTubeVideoSummary[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (video: YouTubeVideoSummary) => {
    setError(null);
    setSelected((prev) =>
      prev.some((item) => item.videoId === video.videoId)
        ? prev.filter((item) => item.videoId !== video.videoId)
        : [...prev, video]
    );
  };

  const handleAdd = async () => {
    if (selected.length === 0 || isAdding) return;
    setIsAdding(true);
    setError(null);
    try {
      await onAdd(selected);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add those videos.');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isAdding}
      title="Add to the watch queue"
      description="Search YouTube or paste a link. Everyone in the room can add videos."
      className="max-w-3xl"
    >
      <div className="space-y-4">
        <YouTubeBrowser
          onSelect={handleSelect}
          selectedIds={selected.map((video) => video.videoId)}
        />

        {selected.length > 0 && (
          <div className="rounded-2xl border border-[#E8DDC5]/15 bg-[#173D30]/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-mono uppercase tracking-[0.14em] text-[#CDBF9F]/90">
                {selected.length} selected
              </p>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-xs font-semibold text-[#B397FF] hover:text-[#D2C1FF] cursor-pointer"
              >
                Clear
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selected.map((video) => (
                <span
                  key={video.videoId}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#E8DDC5]/25 bg-[#E8DDC5] px-2 py-1 text-xs font-medium text-[#102B23]"
                >
                  <span className="truncate max-w-[220px]">{video.title}</span>
                  <button
                    type="button"
                    onClick={() => handleSelect(video)}
                    className="rounded-full p-0.5 hover:bg-[#173D30]/15 cursor-pointer"
                    aria-label={`Remove ${video.title}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-xl border border-[#DC2626]/40 bg-[#2A1215] px-3 py-2 text-[13px] text-[#FCA5A5]">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-[#E8DDC5]/12 pt-3">
          <Button type="button" variant="ghostSand" onClick={onClose} disabled={isAdding}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            isLoading={isAdding}
            disabled={selected.length === 0}
            onClick={() => void handleAdd()}
            leftIcon={<ListPlus className="w-4 h-4" />}
          >
            {selected.length > 0
              ? `Add ${selected.length} to queue`
              : 'Select videos to add'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
