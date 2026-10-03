#!/usr/bin/env node
/**
 * Run this FIRST.
 *
 * Cutroom leans on video capabilities that are account-gated and, more
 * importantly, slow in ways that change how you build the UI. Transcription
 * is the long pole and it is asynchronous — knowing whether it takes twenty
 * seconds or four minutes on your plan decides whether the demo is live or
 * pre-warmed.
 *
 *   node scripts/verify-cloudinary.mjs
 */

import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUD || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('Missing Cloudinary credentials. Copy .env.example to .env first.');
  process.exit(1);
}

cloudinary.config({
  cloud_name: CLOUD, api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET, secure: true,
});

const ok = (l, x = '') => console.log(`  ✓ ${l}${x ? `  ${x}` : ''}`);
const bad = (l, w) => console.log(`  ✗ ${l}  ${w}`);

const url = (chain, id, ext) =>
  `https://res.cloudinary.com/${CLOUD}/video/upload/${chain}/${id}.${ext}`;

async function hit(label, chain, id, ext = 'mp4', timeoutMs = 120_000) {
  const target = url(chain, id, ext);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(target);
    if (res.ok) { ok(label, `${Date.now() - started}ms`); return true; }
    if (res.status === 423) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    bad(label, res.headers.get('x-cld-error') ?? `HTTP ${res.status}`);
    console.log(`      ${target}`);
    return false;
  }
  bad(label, `still processing after ${timeoutMs / 1000}s`);
  return false;
}

async function main() {
  console.log(`\nCloudinary account: ${CLOUD}\n`);

  console.log('Uploading a test video');
  const asset = await cloudinary.uploader.upload(
    'https://res.cloudinary.com/demo/video/upload/dog.mp4',
    { folder: 'cutroom/_verify', resource_type: 'video', raw_convert: 'google_speech' },
  );
  ok('video upload', `${asset.width}×${asset.height}, ${asset.duration}s`);

  console.log('\nClip transforms');
  await hit('segment cut (so_/eo_)', 'so_1,eo_4', asset.public_id);
  await hit('vertical reframe with subject tracking', 'so_1,eo_4/c_fill,g_auto,w_1080,h_1920', asset.public_id);
  await hit('square reframe', 'so_1,eo_4/c_fill,g_auto,w_1080,h_1080', asset.public_id);
  await hit('poster frame', 'so_2,c_fill,g_auto,w_1080,h_1920,f_jpg', asset.public_id, 'jpg');
  await hit('eco preview', 'c_limit,w_960,q_auto:eco,f_auto', asset.public_id);

  console.log('\nTranscription (the long pole)');
  const started = Date.now();
  let cues = 0;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `https://res.cloudinary.com/${CLOUD}/raw/upload/${asset.public_id}.transcript`,
    );
    if (res.ok) {
      const data = await res.json();
      cues = Array.isArray(data) ? data.length : 0;
      ok('speech-to-text', `${Math.round((Date.now() - started) / 1000)}s, ${cues} utterances`);
      break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!cues) {
    bad('speech-to-text', 'no transcript after 100s');
    console.log('      Without this there is no clip planning. This is a blocker.');
  }

  if (cues) {
    console.log('\nBurned captions');
    await hit(
      'subtitle overlay',
      `so_1,eo_4/c_fill,g_auto,w_1080,h_1920/l_subtitles:arial_60_bold:${asset.public_id.replace(/\//g, ':')}.transcript,co_white/fl_layer_apply,g_south,y_260`,
      asset.public_id,
    );
  }

  console.log('\nRead the transcription time above. It decides whether you demo live.');
  console.log('Over about 60s for a short clip means pre-warm the demo video.\n');
}

main().catch((e) => {
  console.error('\nVerification failed:', e?.error?.message ?? e.message);
  process.exit(1);
});
