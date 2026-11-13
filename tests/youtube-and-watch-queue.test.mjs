import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.join(process.cwd(), 'src'),
  },
});

const { extractYouTubeId } = jiti(path.join(process.cwd(), 'src/lib/utils/youtube.ts'));
const {
  parseIso8601Duration,
  normalizeYouTubeSearchQuery,
  isPlayableYouTubeVideo,
} = jiti(path.join(process.cwd(), 'src/lib/services/youtubeService.ts'));
const {
  describePlaybackError,
  getYouTubeWatchUrl,
} = jiti(path.join(process.cwd(), 'src/lib/utils/youtubeErrors.ts'));
const {
  savePendingQueue,
  consumePendingQueue,
  isQueueVideoInput,
} = jiti(path.join(process.cwd(), 'src/lib/utils/pendingQueue.ts'));
const { mapQueueRow, mergeQueueItem, sortQueueItems } = jiti(
  path.join(process.cwd(), 'src/lib/services/queueService.ts')
);

class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}

describe('YouTube-first browsing and playback helpers', () => {
  it('1. Parses standard YouTube watch, shorts, live, embed, and youtu.be links', () => {
    assert.equal(
      extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
    assert.equal(
      extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'),
      'dQw4w9WgXcQ'
    );
    assert.equal(
      extractYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
    assert.equal(
      extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ'
    );
    assert.equal(extractYouTubeId('https://example.com/video.mp4'), null);
  });

  it('2. Parses ISO-8601 video durations into seconds', () => {
    assert.equal(parseIso8601Duration('PT1H2M3S'), 3723);
    assert.equal(parseIso8601Duration('PT45S'), 45);
    assert.equal(parseIso8601Duration('P1DT2H'), 93600);
    assert.equal(parseIso8601Duration('LIVE'), 0);
    assert.equal(parseIso8601Duration(undefined), 0);
  });

  it('3. Normalizes search input and rejects unplayable search results', () => {
    assert.equal(normalizeYouTubeSearchQuery('   lo-fi    beats  '), 'lo-fi beats');
    assert.equal(normalizeYouTubeSearchQuery(null), '');
    assert.equal(normalizeYouTubeSearchQuery('x'.repeat(300)).length, 120);

    const base = {
      videoId: 'abc12345678',
      title: 'Test',
      description: '',
      channelId: 'channel',
      channelTitle: 'Creator',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc12345678/mqdefault.jpg',
      publishedAt: '2026-01-01T00:00:00Z',
      durationSeconds: 120,
      isLive: false,
      embeddable: true,
      privacyStatus: 'public',
      madeForKids: false,
    };

    assert.equal(isPlayableYouTubeVideo(base), true);
    assert.equal(isPlayableYouTubeVideo({ ...base, embeddable: false }), false);
    assert.equal(isPlayableYouTubeVideo({ ...base, privacyStatus: 'private' }), false);
    assert.equal(isPlayableYouTubeVideo({ ...base, isLive: true }), false);
    assert.equal(isPlayableYouTubeVideo({ ...base, durationSeconds: 0 }), false);
  });

  it('4. Explains IFrame player errors and provides a Watch on YouTube fallback', () => {
    assert.match(describePlaybackError(101, true).title, /Embedding disabled/);
    assert.match(describePlaybackError(150, true).title, /Embedding disabled/);
    assert.match(describePlaybackError(100, true).title, /Video unavailable/);
    assert.match(describePlaybackError(2, true).message, /malformed/);
    assert.match(describePlaybackError(null, false).title, /could not be played/);
    assert.equal(
      getYouTubeWatchUrl('dQw4w9WgXcQ'),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.equal(getYouTubeWatchUrl('https://example.com/movie.mp4'), null);
  });

  it('5. Saves, validates, and consumes a pending queue exactly once', () => {
    const storage = new MemoryStorage();
    const valid = {
      videoId: 'dQw4w9WgXcQ',
      videoType: 'youtube',
      title: 'A valid video',
      channelTitle: 'Creator',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      durationSeconds: 212,
    };
    const invalid = { videoType: 'netflix', title: '' };

    assert.equal(isQueueVideoInput(valid), true);
    assert.equal(isQueueVideoInput(invalid), false);

    savePendingQueue('sync-abcd', [valid, invalid], storage);
    const consumed = consumePendingQueue('SYNC-ABCD', storage);
    assert.equal(consumed.length, 1);
    assert.equal(consumed[0].videoId, 'dQw4w9WgXcQ');
    assert.deepEqual(consumePendingQueue('SYNC-ABCD', storage), []);
  });

  it('6. Merges realtime queue rows without duplicates and sorts by position', () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      room_id: '22222222-2222-4222-8222-222222222222',
      video_id: 'dQw4w9WgXcQ',
      video_url: '',
      video_type: 'youtube',
      title: 'Video A',
      channel_title: 'Creator',
      thumbnail_url: null,
      duration_seconds: 60,
      position: 1,
      added_by: '33333333-3333-4333-8333-333333333333',
      created_at: '2026-11-13T10:00:00.000Z',
    };

    const mapped = mapQueueRow(row);
    assert.equal(mapped.videoId, 'dQw4w9WgXcQ');
    assert.equal(mapped.videoType, 'youtube');

    const merged = mergeQueueItem([mapped], { ...mapped, title: 'Updated title' });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, 'Updated title');

    const sorted = sortQueueItems([
      { ...mapped, id: 'b', position: 2 },
      { ...mapped, id: 'a', position: 0 },
    ]);
    assert.deepEqual(
      sorted.map((item) => item.id),
      ['a', 'b']
    );
  });
});

describe('YouTube server routes and queue persistence wiring', () => {
  const read = (relativePath) =>
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  it('7. YouTube routes use a server-only API key and normalize error responses', () => {
    const searchRoute = read('src/app/api/youtube/search/route.ts');
    const videosRoute = read('src/app/api/youtube/videos/route.ts');
    const service = read('src/lib/services/youtubeService.ts');

    assert.match(searchRoute, /searchYouTubeVideos/);
    assert.match(videosRoute, /lookupYouTubeVideo/);
    assert.match(service, /process\.env\.YOUTUBE_API_KEY/);
    assert.doesNotMatch(service, /NEXT_PUBLIC_YOUTUBE/);
    assert.doesNotMatch(searchRoute, /NEXT_PUBLIC_YOUTUBE/);
    assert.doesNotMatch(videosRoute, /NEXT_PUBLIC_YOUTUBE/);
    assert.match(service, /YOUTUBE_QUOTA_EXCEEDED/);
    assert.match(service, /YOUTUBE_NOT_CONFIGURED/);
    assert.match(service, /videoEmbeddable: 'true'/);
  });

  it('8. Queue migration includes RLS, control authority, and atomic RPCs', () => {
    const migration = read('supabase/migrations/012_room_queue.sql');
    const fullSetup = read('supabase/full_setup.sql');

    for (const sql of [migration, fullSetup]) {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.room_queue_items/);
      assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
      assert.match(sql, /can_control_room_queue/);
      assert.match(sql, /add_room_queue_item/);
      assert.match(sql, /reorder_room_queue/);
      assert.match(sql, /added_by = auth\.uid\(\)/);
      assert.match(sql, /supabase_realtime ADD TABLE public\.room_queue_items/);
    }
  });

  it('9. UI routes source selection, browsing, and watching separately', () => {
    const home = read('src/app/page.tsx');
    const browse = read('src/app/browse/page.tsx');
    const roomView = read('src/components/room/RoomView.tsx');
    const player = read('src/components/player/UniversalPlayer.tsx');
    const roomHook = read('src/hooks/useRoom.ts');

    assert.match(home, /router\.push\('\/browse'\)/);
    assert.match(home, /Netflix/);
    assert.match(home, /Prime Video/);
    assert.match(home, /Coming soon/);
    assert.match(home, /useLoadingStages\(/);
    assert.match(home, /fetchDashboardData\(/);

    assert.match(browse, /YouTubeBrowser/);
    assert.match(browse, /savePendingQueue/);

    assert.match(roomView, /useRoomQueue/);
    assert.match(roomView, /autoPlayOnLoad/);
    assert.match(roomView, /onEnded/);
    assert.match(roomView, /RoomQueuePanel/);
    assert.match(roomView, /YouTubeQueueModal/);

    assert.match(player, /getLastErrorCode/);
    assert.match(player, /Watch on YouTube/);
    assert.match(player, /autoPlayOnLoad/);
    assert.match(roomHook, /table: 'room_queue_items'/);
    assert.match(roomHook, /emitRoomQueueChange/);
  });

  it('10. Environment template documents the server-only YouTube key', () => {
    const envExample = read('.env.example');
    assert.match(envExample, /YOUTUBE_API_KEY=/);
    assert.doesNotMatch(envExample, /NEXT_PUBLIC_YOUTUBE_API_KEY/);
  });
});
