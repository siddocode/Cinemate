import { extractYouTubeId } from './youtube';

export interface PlaybackErrorInfo {
  code: number | null;
  title: string;
  message: string;
}

export function describePlaybackError(
  code: number | null,
  isYouTube: boolean
): PlaybackErrorInfo {
  if (!isYouTube) {
    return {
      code,
      title: 'This video could not be played',
      message:
        'The direct video link may be offline, blocked by CORS, or in an unsupported format. Try another source.',
    };
  }

  const numericCode = code != null && !isNaN(Number(code)) ? Number(code) : null;

  switch (numericCode) {
    case 2:
      return {
        code,
        title: 'Invalid YouTube video',
        message: 'The YouTube link is malformed. Pick another video or paste a fresh link.',
      };
    case 5:
      return {
        code,
        title: 'Playback failed in this browser',
        message:
          'YouTube could not play this video in the embedded player. Try refreshing or open it on YouTube.',
      };
    case 100:
      return {
        code,
        title: 'Video unavailable',
        message:
          'This video was removed, made private, or is not available in your region. Choose another video.',
      };
    case 101:
    case 150:
      return {
        code,
        title: 'Embedding disabled',
        message:
          'The video owner does not allow this video to be played on other sites. Choose another video.',
      };
    default:
      return {
        code,
        title: 'YouTube playback error',
        message:
          'YouTube could not play this video here. Try another video or watch this one directly on YouTube.',
      };
  }
}

export function getYouTubeWatchUrl(videoUrl: string): string | null {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}
