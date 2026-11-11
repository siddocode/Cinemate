'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { extractYouTubeId } from '@/lib/utils/youtube';
import { storageService } from '@/lib/services/storageService';
import { VideoSourceType } from '@/core/types/player.types';
import { Tv, Link as LinkIcon, Upload, Check, AlertCircle } from 'lucide-react';

interface ChangeVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  currentVideoUrl: string;
  onSelectVideo: (url: string, type: VideoSourceType) => Promise<void>;
}

export const ChangeVideoModal: React.FC<ChangeVideoModalProps> = ({
  isOpen,
  onClose,
  roomId,
  currentVideoUrl,
  onSelectVideo,
}) => {
  const [activeTab, setActiveTab] = useState<VideoSourceType>('youtube');
  const [youtubeInput, setYoutubeInput] = useState(currentVideoUrl);
  const [directUrlInput, setDirectUrlInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (!selectedFile) {
      setError('Please select a video file first.');
      return;
    }

    setError('');
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const res = await storageService.uploadVideo(
        selectedFile,
        roomId,
        (progress) => setUploadProgress(progress)
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Change Video Source"
      description="Choose YouTube, a direct video link, or upload a video clip."
    >
      <div className="space-y-4">
        {/* Source Switcher Tabs */}
        <div className="grid grid-cols-3 p-1 bg-neutral-950 rounded-xl border border-neutral-800 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('youtube');
              setError('');
            }}
            className={`py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'youtube'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5 text-indigo-400" />
            YouTube
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('url');
              setError('');
            }}
            className={`py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'url'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5 text-purple-400" />
            Direct URL
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('upload');
              setError('');
            }}
            className={`py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-neutral-800 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-pink-400" />
            Upload (50MB)
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
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                leftIcon={<Check className="w-4 h-4" />}
              >
                Watch YouTube
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
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                leftIcon={<Check className="w-4 h-4" />}
              >
                Load Video URL
              </Button>
            </div>
          </form>
        )}

        {/* Tab 3: Upload Video Clip */}
        {activeTab === 'upload' && (
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="border-2 border-dashed border-neutral-700 hover:border-indigo-500 rounded-xl p-6 text-center transition-colors cursor-pointer relative bg-neutral-900/50">
              <input
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={isUploading}
              />
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-indigo-400" />
                <span className="text-sm font-medium text-white">
                  {selectedFile ? selectedFile.name : 'Click or drag video file here'}
                </span>
                <span className="text-xs text-neutral-400">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB selected`
                    : 'MP4, WebM, or MOV up to 50MB (Supabase Storage limit)'}
                </span>
              </div>
            </div>

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300">
                  <span>Uploading to room storage...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/60 p-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isUploading}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                disabled={!selectedFile}
                leftIcon={<Upload className="w-4 h-4" />}
              >
                Upload & Play
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
