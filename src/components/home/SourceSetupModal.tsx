'use client';

import React, { useState } from 'react';
import { Link2, Upload, ArrowRight, Film } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export type SourceSetupMode = 'url' | 'upload';

interface SourceSetupModalProps {
  mode: SourceSetupMode;
  isOpen: boolean;
  isBusy?: boolean;
  onClose: () => void;
  onConfirm: (payload: { title: string; url?: string }) => void;
}

export const SourceSetupModal: React.FC<SourceSetupModalProps> = ({
  mode,
  isOpen,
  isBusy = false,
  onClose,
  onConfirm,
}) => {
  const [roomTitle, setRoomTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const isUrlMode = mode === 'url';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isBusy) return;
    setError('');

    if (isUrlMode) {
      const trimmed = url.trim();
      if (!trimmed) {
        setError('Paste a direct video URL to start.');
        return;
      }
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        setError('Enter a valid URL beginning with https://');
        return;
      }
      onConfirm({ title: roomTitle.trim(), url: trimmed });
      return;
    }

    onConfirm({ title: roomTitle.trim() });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      preventClose={isBusy}
      title={isUrlMode ? 'Watch a direct video link' : 'Upload a personal clip'}
      description={
        isUrlMode
          ? 'Paste a direct video file URL (MP4, WebM, or HLS). It will load in the synced player.'
          : 'Create the room first, then upload a video up to 50MB from inside the screening room.'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Room name"
          placeholder="e.g. Movie Night"
          value={roomTitle}
          onChange={(event) => setRoomTitle(event.target.value)}
          maxLength={50}
          disabled={isBusy}
          tone="dark"
          autoFocus
        />

        {isUrlMode ? (
          <Input
            label="Direct video URL"
            placeholder="https://cdn.example.com/movie.mp4"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            error={error}
            leftIcon={<Link2 className="w-4 h-4" />}
            disabled={isBusy}
            helperText="The link should point directly to a video file or supported stream."
            tone="dark"
          />
        ) : (
          <div className="rounded-2xl border border-[#E8DDC5]/15 bg-[#173D30]/60 p-3.5">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0B1E17] border border-[#E8DDC5]/15 text-[#B397FF]">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-[#F7F4EC]">
                  Upload opens inside the room
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#CDBF9F]/90">
                  You can pick your file after the room is created. Personal uploads
                  are capped at 50MB and cleaned up when the room closes.
                </p>
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-[#F2B8B2]">{error}</p>}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          variant="primary"
          className="w-full"
          isLoading={isBusy}
          leftIcon={isUrlMode ? <Film className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          rightIcon={<ArrowRight className="w-4 h-4" />}
        >
          {isUrlMode ? 'Create & Play Link' : 'Create & Open Upload'}
        </Button>
      </form>
    </Modal>
  );
};
