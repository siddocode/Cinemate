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

const {
  parseHttpUrl,
  extractTweetId,
  isTweetLink,
  isTcoLink,
  looksLikeDirectMediaUrl,
  isPrivateHostname,
  describeUnsupportedPlatform,
} = jiti(path.join(process.cwd(), 'src/lib/utils/socialVideo.ts'));

const {
  buildSyndicationToken,
  pickBestMp4Variant,
  extractVideoFromTweetPageHtml,
  extractVideoFromSyndication,
} = jiti(path.join(process.cwd(), 'src/lib/services/twitterVideoService.ts'));

describe('Video link detection and Twitter/X resolution helpers', () => {
  it('1. Extracts tweet IDs from twitter.com, x.com, mobile links, and scheme-less input', () => {
    assert.equal(
      extractTweetId('https://x.com/someuser/status/1580661436132757506?s=20'),
      '1580661436132757506'
    );
    assert.equal(
      extractTweetId('https://twitter.com/someuser/status/1580661436132757506/photo/1'),
      '1580661436132757506'
    );
    assert.equal(
      extractTweetId('https://mobile.twitter.com/someuser/statuses/123456'),
      '123456'
    );
    assert.equal(extractTweetId('x.com/someuser/status/999'), '999');
    assert.equal(extractTweetId('https://x.com/home'), null);
    assert.equal(extractTweetId('https://example.com/status/123'), null);
    assert.equal(extractTweetId('not a link at all'), null);
  });

  it('2. Detects tweet, t.co, and direct media links', () => {
    assert.equal(isTweetLink('https://x.com/a/status/1'), true);
    assert.equal(isTweetLink('https://t.co/abc123'), true);
    assert.equal(isTweetLink('https://example.com/video.mp4'), false);

    assert.equal(isTcoLink('https://t.co/abc123'), true);
    assert.equal(isTcoLink('https://x.com/a/status/1'), false);

    assert.equal(looksLikeDirectMediaUrl('https://cdn.example.com/movie.mp4'), true);
    assert.equal(looksLikeDirectMediaUrl('https://cdn.example.com/movie.webm?token=1'), true);
    assert.equal(looksLikeDirectMediaUrl('https://cdn.example.com/stream.m3u8?token=1'), true);
    assert.equal(looksLikeDirectMediaUrl('https://x.com/a/status/1'), false);
    assert.equal(looksLikeDirectMediaUrl('https://example.com/article'), false);
  });

  it('2b. Flags page-only platforms with a friendly message', () => {
    assert.match(describeUnsupportedPlatform('www.instagram.com') ?? '', /Instagram/);
    assert.match(describeUnsupportedPlatform('www.tiktok.com') ?? '', /TikTok/);
    assert.match(describeUnsupportedPlatform('m.facebook.com') ?? '', /Facebook/);
    assert.match(describeUnsupportedPlatform('vimeo.com') ?? '', /Vimeo/);
    assert.match(describeUnsupportedPlatform('www.netflix.com') ?? '', /streaming service/);
    assert.equal(describeUnsupportedPlatform('video.twimg.com'), null);
    assert.equal(describeUnsupportedPlatform('notinstagram.com'), null);
    assert.equal(describeUnsupportedPlatform('example.com'), null);
  });

  it('3. Rejects private and loopback hosts to prevent SSRF', () => {
    for (const host of [
      'localhost',
      'app.localhost',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'metadata.google.internal',
      'printer.local',
    ]) {
      assert.equal(isPrivateHostname(host), true, `${host} should be private`);
    }

    for (const host of ['video.twimg.com', 'example.com', '172.32.0.1', '8.8.8.8']) {
      assert.equal(isPrivateHostname(host), false, `${host} should be public`);
    }
  });

  it('4. Builds the syndication token and picks the highest-bitrate MP4', () => {
    assert.equal(buildSyndicationToken('1580661436132757506'), '3txslhgbjje');
    assert.equal(buildSyndicationToken('20'), '6dq1a2xwd93');
    assert.equal(buildSyndicationToken('nope'), '');

    assert.equal(
      pickBestMp4Variant([
        { bitrate: 256000, contentType: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
        { bitrate: 2176000, contentType: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
        { contentType: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
      ]),
      'https://video.twimg.com/high.mp4'
    );

    assert.equal(
      pickBestMp4Variant([
        { contentType: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
      ]),
      null
    );
  });

  it('5. Parses video variants out of the public tweet page HTML', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg" />
    </head><body><script>
      {"video_info":{"variants":[
        {"bitrate":256000,"content_type":"video/mp4","url":"https:\\/\\/video.twimg.com\\/ext_tw_video\\/1\\/pu\\/vid\\/360x360\\/low.mp4?tag=12"},
        {"bitrate":2176000,"content_type":"video/mp4","url":"https:\\/\\/video.twimg.com\\/ext_tw_video\\/1\\/pu\\/vid\\/1280x720\\/high.mp4?tag=12"}
      ]}}
    </script></body></html>`;

    const parsed = extractVideoFromTweetPageHtml(html);
    assert.ok(parsed);
    assert.equal(parsed.videoUrl, 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4?tag=12');
    assert.equal(
      parsed.thumbnailUrl,
      'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg'
    );
    assert.equal(extractVideoFromTweetPageHtml('<html>no video here</html>'), null);
  });

  it('6. Parses syndication payloads with and without mediaDetails', () => {
    const fromMediaDetails = extractVideoFromSyndication({
      mediaDetails: [
        {
          poster: 'https://pbs.twimg.com/poster.jpg',
          video_info: {
            variants: [
              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/a.mp4' },
              { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/b.mp4' },
            ],
          },
        },
      ],
    });
    assert.ok(fromMediaDetails);
    assert.equal(fromMediaDetails.videoUrl, 'https://video.twimg.com/b.mp4');
    assert.equal(fromMediaDetails.thumbnailUrl, 'https://pbs.twimg.com/poster.jpg');

    const fromVideoField = extractVideoFromSyndication({
      video: {
        variants: [{ type: 'video/mp4', src: 'https://video.twimg.com/c.mp4' }],
      },
    });
    assert.ok(fromVideoField);
    assert.equal(fromVideoField.videoUrl, 'https://video.twimg.com/c.mp4');

    assert.equal(extractVideoFromSyndication({ text: 'hello' }), null);
    assert.equal(extractVideoFromSyndication(null), null);
  });

  it('7. Parses http(s) URLs and rejects unsupported schemes', () => {
    assert.equal(parseHttpUrl('https://example.com/a.mp4')?.hostname, 'example.com');
    assert.equal(parseHttpUrl('example.com/a.mp4')?.protocol, 'https:');
    assert.equal(parseHttpUrl('javascript:alert(1)'), null);
    assert.equal(parseHttpUrl('file:///etc/passwd'), null);
    assert.equal(parseHttpUrl('   '), null);
  });
});

describe('Video link resolution wiring', () => {
  const read = (relativePath) =>
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  it('8. The resolve route resolves tweets and blocks private hosts', () => {
    const route = read('src/app/api/video/resolve/route.ts');
    assert.match(route, /resolveTweetVideo/);
    assert.match(route, /isPrivateHostname/);
    assert.match(route, /probeContentType|classifyContentType/);
    assert.match(route, /NOT_A_VIDEO_FILE/);
    assert.match(route, /YOUTUBE_LINK/);
    assert.match(route, /describeUnsupportedPlatform/);
    assert.doesNotMatch(route, /NEXT_PUBLIC_/);
  });

  it('9. Both URL entry points resolve links before selecting a video', () => {
    const changeModal = read('src/components/room/ChangeVideoModal.tsx');
    const setupModal = read('src/components/home/SourceSetupModal.tsx');
    assert.match(changeModal, /resolvePlayableVideoUrl/);
    assert.match(setupModal, /resolvePlayableVideoUrl/);
  });

  it('10. The HTML5 adapter retries once without crossOrigin on media errors', () => {
    const adapter = read('src/core/adapters/HTML5VideoAdapter.ts');
    assert.match(adapter, /corsFallbackApplied/);
    assert.match(adapter, /removeAttribute\('crossorigin'\)/);
  });

  it('11. The HTML5 adapter delegates HLS streams to hls.js with native fallback', () => {
    const adapter = read('src/core/adapters/HTML5VideoAdapter.ts');
    const pkg = read('package.json');
    assert.match(adapter, /HLS_SOURCE_PATTERN/);
    assert.match(adapter, /\.m3u8/);
    assert.match(adapter, /import\(['"]hls\.js['"]\)/);
    assert.match(adapter, /Hls\.isSupported\(\)/);
    assert.match(adapter, /hlsInstance/);
    assert.match(pkg, /"hls\.js"/);
  });
});
