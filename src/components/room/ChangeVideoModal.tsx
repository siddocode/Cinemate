'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { extractYouTubeId } from '@/lib/utils/youtube';
import { storageService } from '@/lib/services/storageService';
import { bandwidthService, BandwidthMetrics } from '@/lib/services/bandwidthService';
import { useSession } from '@/hooks/useSession';
import { VideoSourceType } from '@/core/types/player.types';
import { Tv, Link as LinkIcon, Upload, Check, AlertCircle, ShieldAlert, X, Film } from 'lucide-react';

interface ChangeVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  currentVideoUrl: string;
  onSelectVideo: (url: string, type: VideoSourceType) => Promise<void>;
  initialTab?: VideoSourceType;
}

export const ChangeVideoModal: React.FC<ChangeVideoModalProps> = (props) => {
  if (!props.isOpen) return null;
  return (
    <ChangeVideoModalContent
      key={`${props.roomId}:${props.currentVideoUrl}:${props.initialTab || 'youtube'}`}
      {...props}
    />
  );
};

const ChangeVideoModalContent: React.FC<ChangeVideoModalProps> = ({
  onClose,
  roomId,
  currentVideoUrl,
  onSelectVideo,
  initialTab = 'youtube',
}) => {
  const { user } = useSession();
  const [activeTab, setActiveTab] = useState<VideoSourceType>(initialTab);
  const [youtubeInput, setYoutubeInput] = useState(() =>
    extractYouTubeId(currentVideoUrl) ? currentVideoUrl : ''
  );
  const [directUrlInput, setDirectUrlInput] = useState(() =>
    currentVideoUrl &&
    !extractYouTubeId(currentVideoUrl) &&
    !currentVideoUrl.includes('/storage/v1/object/') &&
    (currentVideoUrl.startsWith('http://') || currentVideoUrl.startsWith('https://'))
      ? currentVideoUrl
      : ''
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<BandwidthMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    bandwidthService.getMetrics(user.id).then((m) => {
      if (!cancelled) {
        setMetrics(m);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return;
    setError('');

    const trimmed = youtubeInput.trim();
    if (!trimmed) {
      setError('Please enter a YouTube video URL or ID.');
      return;
    }

    const videoId = extractYouTubeId(trimmed);
    if (!videoId) {
      setError('Invalid YouTube link. Please paste a valid YouTube watch or shorts URL.');
      return;
    }

    setIsUploading(true);
    try {
      await onSelectVideo(videoId, 'youtube');
      onClose();
    } catch {
      setError('Failed to update YouTube video.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDirectUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return;
    setError('');

    const trimmed = directUrlInput.trim();
    if (!trimmed) {
      setError('Please enter a direct video URL.');
      return;
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setError('Please enter a valid URL starting with https://');
      return;
    }

    setIsUploading(true);
    try {
      await onSelectVideo(trimmed, 'url');
      onClose();
    } catch {
      setError('Failed to update video URL.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = storageService.validateVideoFile(file);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid video file.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) return;
    if (!selectedFile) {
      setError('Please select a video file first.');
      return;
    }

    setError('');
    setIsUploading(true);
    setUploadProgress(10);

    try {
      // Remove any previous uploaded video in this room before uploading the replacement
      await storageService.cleanupRoomVideos(roomId);

      const res = await storageService.uploadVideo(
        selectedFile,
        roomId,
        (progress) => setUploadProgress(progress),
        user.id || 'guest'
      );

      if (res.error || !res.url) {
        setError(res.error || 'Upload failed.');
        setIsUploading(false);
        return;
      }

      await onSelectVideo(res.url, 'upload');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isUploading]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end pointer-events-none"
      role="dialog"
      aria-modal="true"
      data-prevent-close={isUploading /* preventClose={isUploading} */}
    >
      {/* Soft non-intrusive backdrop on mobile (tap to close); hidden on desktop so video remains clickable */}
      <div
        className="absolute inset-0 bg-[#071611]/45 backdrop-blur-[1px] transition-opacity drawer-backdrop pointer-events-auto lg:hidden"
        onClick={() => {
          if (!isUploading) onClose();
        }}
        aria-hidden="true"
      />

      {/* Cinema slide-over side drawer */}
      <aside className="relative z-10 flex h-full w-full max-w-lg lg:w-[32rem] xl:w-[36rem] lg:max-w-none flex-col border-l border-[#E8DDC5]/16 bg-[#0B1E17] shadow-[-28px_0_72px_rgba(0,0,0,0.65)] drawer-enter pointer-events-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#E8DDC5]/12 px-4 py-3.5 shrink-0 bg-[#0E281F]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#9670FF]/35 bg-[#9670FF]/12 text-[#B397FF]">
              <Film className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-serif text-lg sm:text-xl font-semibold leading-tight text-[#F7F4EC] truncate">
                Select Video Source
              </h2>
              <p className="text-xs text-[#CDBF9F]/85 truncate mt-0.5">
                Load a YouTube link, direct streaming URL, or personal clip up to 50MB.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-full p-1.5 text-[#CDBF9F] hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer shrink-0 disabled:opacity-40"
            aria-label="Close video source selector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
        {/* Dark pill switcher */}
        <div className="grid grid-cols-3 p-1 bg-[#173D30] rounded-full text-[13px]">
          <button
            type="button"
            disabled={isUploading}
            onClick={() => {
              if (isUploading) return;
              setActiveTab('youtube');
              setError('');
            }}
            className={`py-2 rounded-full font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
              activeTab === 'youtube'
                ? 'bg-[#0B1E17] text-[#F7F4EC] shadow-sm'
                : 'text-[#CDBF9F]/90 hover:text-[#F7F4EC]'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            YouTube
          </button>
          <button
            type="button"
            disabled={isUploading}
            onClick={() => {
              if (isUploading) return;
              setActiveTab('url');
              setError('');
            }}
            className={`py-2 rounded-full font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
              activeTab === 'url'
                ? 'bg-[#0B1E17] text-[#F7F4EC] shadow-sm'
                : 'text-[#CDBF9F]/90 hover:text-[#F7F4EC]'
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5" />
            Direct URL
          </button>
          <button
            type="button"
            disabled={isUploading}
            onClick={() => {
              if (isUploading) return;
              setActiveTab('upload');
              setError('');
            }}
            className={`py-2 rounded-full font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
              activeTab === 'upload'
                ? 'bg-[#0B1E17] text-[#F7F4EC] shadow-sm'
                : 'text-[#CDBF9F]/90 hover:text-[#F7F4EC]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Upload
          </button>
        </div>

        {/* Tab 1: YouTube */}
        {activeTab === 'youtube' && (
          <form onSubmit={handleYouTubeSubmit} className="space-y-4">
            <Input
              label="YouTube URL or Video ID"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeInput}
              onChange={(e) => setYoutubeInput(e.target.value)}
              error={error}
              leftIcon={<Tv className="w-4 h-4" />}
              disabled={isUploading}
              tone="dark"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghostSand"
                size="sm"
                onClick={onClose}
                disabled={isUploading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                leftIcon={<Check className="w-3.5 h-3.5" />}
              >
                {isUploading ? 'Loading Video…' : 'Watch YouTube'}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 2: Direct Video URL */}
        {activeTab === 'url' && (
          <form onSubmit={handleDirectUrlSubmit} className="space-y-4">
            <Input
              label="Direct Video URL (MP4, WebM)"
              placeholder="https://example.com/video.mp4"
              value={directUrlInput}
              onChange={(e) => setDirectUrlInput(e.target.value)}
              error={error}
              helperText="Paste any publicly accessible direct video streaming link."
              leftIcon={<LinkIcon className="w-4 h-4" />}
              disabled={isUploading}
              tone="dark"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghostSand"
                size="sm"
                onClick={onClose}
                disabled={isUploading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                leftIcon={<Check className="w-3.5 h-3.5" />}
              >
                {isUploading ? 'Loading Stream…' : 'Load Video URL'}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 3: Upload Video Clip */}
        {activeTab === 'upload' && (
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            {metrics?.isHardBlocked && (
              <div className="flex items-start gap-2.5 text-[13px] text-[#FCA5A5] bg-[#2A1215] border border-[#DC2626]/40 p-3.5 rounded-xl">
                <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-[#FCA5A5]">
                    Personal Video Storage Safe Limit Reached
                  </p>
                  <p className="text-[#FCA5A5]/90 leading-relaxed">
                    Monthly storage egress safe ceiling reached (~1.8GB / 2.0GB).
                    Personal uploads are paused—please use <strong>YouTube</strong> or{' '}
                    <strong>Direct URL</strong> instead.
                  </p>
                </div>
              </div>
            )}

            {!metrics?.isHardBlocked && metrics?.isSoftWarning && (
              <div className="flex items-start gap-2.5 text-[13px] text-[#F0C987] bg-[#292214] border border-[#D97706]/40 p-3 rounded-xl">
                <AlertCircle className="w-4 h-4 text-[#E9B872] shrink-0 mt-0.5" />
                <span>
                  Monthly storage egress is at ~75% of free tier. YouTube or direct
                  links are recommended.
                </span>
              </div>
            )}

            <div
              className={`border border-dashed rounded-xl p-6 text-center transition-colors relative bg-[#102B23] ${
                metrics?.isHardBlocked
                  ? 'border-[#E8DDC5]/15 opacity-60 cursor-not-allowed'
                  : 'border-[#E8DDC5]/30 hover:border-[#9670FF] cursor-pointer'
              }`}
            >
              <input
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                disabled={isUploading || Boolean(metrics?.isHardBlocked)}
              />
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-[#173D30] border border-[#E8DDC5]/20 flex items-center justify-center text-[#B397FF]">
                  <Upload className="w-4 h-4" />
                </div>
                <span className="text-sm font-semibold text-[#F7F4EC] max-w-full truncate px-2">
                  {selectedFile ? selectedFile.name : 'Click or drop a video clip here'}
                </span>
                <span className="text-[13px] font-mono text-[#CDBF9F]/85">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB ready`
                    : 'MP4, WebM, or MOV · 50MB max'}
                </span>
              </div>
            </div>

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[13px] text-[#CDBF9F]/90">
                  <span>Uploading to room storage...</span>
                  <span className="font-mono tabular-nums font-semibold text-[#F7F4EC]">
                    {uploadProgress}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#173D30] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#9670FF] transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-[13px] text-[#FCA5A5] bg-[#2A1215] border border-[#DC2626]/40 p-3 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghostSand"
                size="sm"
                onClick={onClose}
                disabled={isUploading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                disabled={!selectedFile || Boolean(metrics?.isHardBlocked)}
                leftIcon={<Upload className="w-3.5 h-3.5" />}
              >
                Upload &amp; Play
              </Button>
            </div>
          </form>
        )}
        </div>
      </aside>
    </div>
  );
};
