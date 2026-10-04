#!/usr/bin/env node
/**
 * Build the group's Bilibili accounts page.
 *
 * What it does:
 *   1. Read bilibili/data/members.json (written by hand: uid + QQ nickname).
 *   2. Ask the Bilibili API for each UID's current nickname and follower count.
 *      A failed request keeps the value from the previous run.
 *   3. Ask for each UID's newest uploads and the tags of those uploads, so that the
 *      page can talk about what everyone is making. Only the newest VIDEO_LIMIT
 *      videos of every member are kept, and a video that is already in the cache
 *      never costs another request: as soon as a known bvid shows up, that member
 *      is done for this run.
 *   4. Sort everyone by follower count, descending, and write bilibili/data/bilibili.json.
 *   5. Replace the {{BILI_TABLE}} and {{BILI_TOTAL}} placeholders in
 *      bilibili/template.html and write the page to bilibili.html in the repository root.
 *
 * Usage:
 *   node bilibili/build.mjs              # fetch from Bilibili, then rebuild the page
 *   node bilibili/build.mjs --offline    # rebuild the page from the cache only
 *
 * Environment:
 *   BILI_COOKIE  Optional. The value of your own Bilibili SESSDATA. GitHub Actions
 *                runners are sometimes turned down by Bilibili's risk control
 *                (code -352, -412 or HTTP 412); a cookie makes the requests much
 *                more reliable, especially for the upload list.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const membersFile = path.join(here, 'data', 'members.json');
const cacheFile = path.join(here, 'data', 'bilibili.json');
const templateFile = path.join(here, 'template.html');
const pageFile = path.join(root, 'bilibili.html');

const HOME_URL = 'https://www.bilibili.com/';
const CARD_API = 'https://api.bilibili.com/x/web-interface/card';
const STAT_API = 'https://api.bilibili.com/x/relation/stat';
const NAV_API = 'https://api.bilibili.com/x/web-interface/nav';
const SEARCH_API = 'https://api.bilibili.com/x/space/wbi/arc/search';
const TAGS_API = 'https://api.bilibili.com/x/tag/archive/tags';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ATTEMPTS = 3;
const REQUEST_GAP_MS = 800;
// The upload list and the tag pages are rate limited much harder than the rest: pace
// them slowly, back off when Bilibili says no, and give up on it for the rest of the
// run after a couple of refusals. Reaching everybody then takes several runs, which is
// exactly what the rotating order below is for.
const UPLOAD_GAP_MS = 5000;
const UPLOAD_JITTER_MS = 2000;
const TAG_GAP_MS = 1500;
const BLOCK_BACKOFF_MS = 10000;
const BLOCK_LIMIT = 2;
const VIDEO_LIMIT = 10;
const TAG_LIMIT = 12;
const TITLE_LIMIT = 120;

const PLACEHOLDER = /\{\{BILI_TABLE\}\}/;
const TOTAL_PLACEHOLDER = /\{\{BILI_TOTAL\}\}/;

// Layout of the generated table, kept in step with the repository's .prettierrc.json
// so that a generated page is already Prettier-formatted.
const TABLE_INDENT = '            ';
const ANCHOR_INDENT = '                      ';
const PRINT_WIDTH = 120;

const offline = process.argv.includes('--offline');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// On GitHub Actions a "::warning::" or "::error::" line becomes an annotation on the
// run, which is where a human actually notices it. Anywhere else the same words are
// printed as an ordinary warning or error, so a local run stays readable.
const onGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const commandText = (text) => String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function warn(message) {
  if (onGitHubActions) console.log(`::warning::${commandText(message)}`);
  else console.warn(message);
}

function fail(message) {
  if (onGitHubActions) console.log(`::error::${commandText(message)}`);
  else console.error(message);
}

/** Start a list at `offset` instead of at its first entry. */
function rotate(list, offset) {
  if (list.length === 0) return list;
  const start = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

/** Cookies for this run: what the front page hands out, plus an optional SESSDATA. */
let requestCookie = '';

/** East Asian Wide and Fullwidth characters count as two columns for Prettier. */
const WIDE_CHAR =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}]|[\u{20000}-\u{3FFFD}]/u;

function displayWidth(text) {
  let width = 0;
  for (const char of text) width += WIDE_CHAR.test(char) ? 2 : 1;
  return width;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Upload titles may carry highlight markup and entities. */
function plainTitle(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim()
    .slice(0, TITLE_LIMIT);
}

// The upload list endpoint is protected by Bilibili's wbi signature: the query is
// signed with a mixin key derived from two keys the site hands out at /nav.
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52
];

const md5 = (text) => createHash('md5').update(text).digest('hex');

function mixinKey(imgKey, subKey) {
  return MIXIN_KEY_ENC_TAB.map((index) => (imgKey + subKey)[index])
    .join('')
    .slice(0, 32);
}

function signedQuery(params, imgKey, subKey) {
  const withTimestamp = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(withTimestamp)
    .sort()
    .map(
      (key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(withTimestamp[key]).replace(/[!'()*]/g, ''))}`
    )
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey(imgKey, subKey))}`;
}

function apiHeaders(referer, cookie = requestCookie) {
  const headers = {
    'User-Agent': USER_AGENT,
    Referer: referer,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
  if (referer.startsWith('https://space.bilibili.com/')) headers.Origin = 'https://space.bilibili.com';
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function getJson(url, referer) {
  const response = await fetch(url, { headers: apiHeaders(referer) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.code !== 0) throw new Error(`API code ${body.code} (${body.message ?? ''})`);
  return body.data;
}

/**
 * Visit the front page first, exactly like a browser would: Bilibili then hands out
 * the buvid cookies that the upload list endpoint expects to see.
 */
async function collectCookies() {
  const jar = new Map();
  try {
    const response = await fetch(HOME_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  } catch (error) {
    warn(`Could not collect cookies from Bilibili: ${error.message}`);
  }
  if (process.env.BILI_COOKIE) jar.set('SESSDATA', process.env.BILI_COOKIE);
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function getWbiKeys() {
  const response = await fetch(NAV_API, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: HOME_URL,
      Accept: 'application/json, text/plain, */*',
      Cookie: requestCookie
    }
  });
  const body = await response.json();
  const imgKey = (body?.data?.wbi_img?.img_url ?? '').split('/').pop().split('.')[0];
  const subKey = (body?.data?.wbi_img?.sub_url ?? '').split('/').pop().split('.')[0];
  if (!imgKey || !subKey) throw new Error('Bilibili did not hand out wbi keys');
  return { imgKey, subKey };
}

/** Risk control answers: -352, -412 and the like mean "slow down", not "no data". */
function isBlocked(error) {
  return /(-352|-412|-799|HTTP 412|HTTP 429)/.test(String(error?.message ?? ''));
}

async function requestAccount(uid) {
  const referer = `https://space.bilibili.com/${uid}/`;
  // The user card endpoint returns the nickname and the follower count in one request.
  try {
    const data = await getJson(`${CARD_API}?mid=${encodeURIComponent(uid)}`, referer);
    const name = data?.card?.name;
    const fans = data?.follower ?? data?.card?.fans;
    if (typeof name !== 'string' || name.length === 0) throw new Error('data.card.name is missing');
    if (typeof fans !== 'number') throw new Error('the follower count is missing');
    return { name, fans };
  } catch (cardError) {
    // Fall back to the follower count alone and keep the cached nickname.
    const data = await getJson(`${STAT_API}?vmid=${encodeURIComponent(uid)}`, referer).catch(() => {
      throw cardError;
    });
    if (typeof data?.follower !== 'number') throw cardError;
    return { name: null, fans: data.follower };
  }
}

async function fetchAccount(uid, previous) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await requestAccount(uid);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await sleep(attempt * 1500 + Math.random() * 500);
    }
  }
  if (previous) console.warn(`     keeping the cached "${previous.bilibili}" / ${previous.fans} followers`);
  throw lastError;
}

async function fetchVideoList(uid, wbi) {
  const params = { mid: uid, ps: VIDEO_LIMIT, pn: 1, order: 'pubdate', tid: 0, platform: 'web', web_location: 1550101 };
  const query = signedQuery(params, wbi.imgKey, wbi.subKey);
  const data = await getJson(`${SEARCH_API}?${query}`, `https://space.bilibili.com/${uid}/video`);
  return (data?.list?.vlist ?? [])
    .filter((item) => item?.bvid)
    .map((item) => ({
      bvid: String(item.bvid),
      title: plainTitle(item.title),
      publishedAt: new Date(Number(item.created ?? 0) * 1000).toISOString()
    }));
}

async function fetchVideoTags(bvid) {
  const data = await getJson(`${TAGS_API}?bvid=${encodeURIComponent(bvid)}`, `https://www.bilibili.com/video/${bvid}`);
  return (data ?? [])
    .map((tag) => String(tag?.tag_name ?? '').trim())
    .filter(Boolean)
    .slice(0, TAG_LIMIT);
}

/**
 * Merge the freshly listed uploads with the cache.
 *
 * - A video that is already cached keeps its tags: no request for it.
 * - As soon as a known bvid shows up, every video below it is older and therefore
 *   already cached too, so the tag requests stop right there.
 * - Only the newest VIDEO_LIMIT uploads are kept, so the cache cannot grow forever.
 * - `tags: null` means "asked but failed"; such a video is asked again next run.
 */
async function refreshVideos(uid, cachedVideos, wbi) {
  const list = await fetchVideoList(uid, wbi);
  const cachedByBvid = new Map((cachedVideos ?? []).map((video) => [video.bvid, video]));
  const merged = [];
  let fresh = 0;
  let stopped = false;

  for (const video of list) {
    const known = cachedByBvid.get(video.bvid);
    if (known && Array.isArray(known.tags)) {
      merged.push({ ...video, tags: known.tags });
      stopped = true;
      continue;
    }
    if (stopped) {
      merged.push({ ...video, tags: Array.isArray(known?.tags) ? known.tags : null });
      continue;
    }
    try {
      merged.push({ ...video, tags: await fetchVideoTags(video.bvid) });
      fresh += 1;
    } catch (error) {
      console.warn(`       tags for ${video.bvid} failed: ${error.message}`);
      merged.push({ ...video, tags: null });
    }
    await sleep(TAG_GAP_MS + Math.random() * 800);
  }

  return { videos: merged.slice(0, VIDEO_LIMIT), fresh };
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (value) => String(value).padStart(2, '0');

/** The cache keeps the instant in UTC; the page shows it in Beijing time. */
function beijingParts(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    seconds: pad(shifted.getUTCSeconds())
  };
}

function formatUpdatedAt(iso) {
  const parts = beijingParts(iso);
  return parts ? `${parts.date} ${parts.time}` : '—';
}

function updatedAtAttribute(iso) {
  const parts = beijingParts(iso);
  return parts ? `${parts.date}T${parts.time}:${parts.seconds}+08:00` : '';
}

function renderNameCell(row) {
  const attributes = `href="https://space.bilibili.com/${escapeHtml(row.uid)}" target="_blank" rel="noopener"`;
  const name = escapeHtml(row.bilibili || '—');
  const singleLine = `<a ${attributes}>${name}</a>`;
  // Prettier moves the text of a long anchor onto its own line; do the same so that
  // generated pages stay Prettier-clean whatever the nickname length is.
  if (displayWidth(ANCHOR_INDENT + singleLine) <= PRINT_WIDTH) return `${ANCHOR_INDENT}${singleLine}`;
  return [`${ANCHOR_INDENT}<a ${attributes}`, `${ANCHOR_INDENT}  >${name}</a`, `${ANCHOR_INDENT}>`].join('\n');
}

function renderTable(rows, updatedAt) {
  const body = rows
    .map((row) => {
      const fans = typeof row.fans === 'number' ? row.fans.toLocaleString('en-US') : '—';
      return [
        '                  <tr>',
        '                    <td class="col-name">',
        renderNameCell(row),
        '                    </td>',
        `                    <td class="col-uid">${escapeHtml(row.uid)}</td>`,
        `                    <td class="col-fans">${fans}</td>`,
        `                    <td class="col-qq">${escapeHtml(row.qq) || '—'}</td>`,
        '                  </tr>'
      ].join('\n');
    })
    .join('\n');

  return [
    `${TABLE_INDENT}<!-- BILI-TABLE:START (generated by bilibili/build.mjs, do not edit this section) -->`,
    '            <p class="table-updated">',
    '              <span data-i18n="updatedLabel">昵称与粉丝数更新于</span>',
    `              <time id="bili-updated" datetime="${escapeHtml(updatedAtAttribute(updatedAt))}">${escapeHtml(
      formatUpdatedAt(updatedAt)
    )}</time>`,
    ...(updatedAtAttribute(updatedAt) ? ['              <span data-i18n="timezoneLabel">北京时间</span>'] : []),
    '            </p>',
    '            <div class="table-scroll">',
    '              <table class="id-table" id="bili-id-table">',
    '                <thead>',
    '                  <tr>',
    '                    <th scope="col" data-i18n="colBiliName">哔哩哔哩昵称</th>',
    '                    <th scope="col" data-i18n="colUid">UID</th>',
    '                    <th scope="col" data-i18n="colFans">粉丝数</th>',
    '                    <th scope="col" data-i18n="colQqName">QQ昵称</th>',
    '                  </tr>',
    '                </thead>',
    '                <tbody>',
    body,
    '                </tbody>',
    '              </table>',
    '            </div>',
    `${TABLE_INDENT}<!-- BILI-TABLE:END -->`
  ].join('\n');
}

// The total sits under the note line at the end of the section.
function renderTotal(rows) {
  return (
    '            <p class="table-count">' +
    `<span data-i18n="countLabel">当前总数：</span><strong id="id-count">${rows.length}</strong></p>`
  );
}

const members = JSON.parse(await readFile(membersFile, 'utf8')).members;
if (!Array.isArray(members) || members.length === 0) throw new Error('bilibili/data/members.json has no members');

let cache = { updatedAt: null, members: [] };
try {
  cache = JSON.parse(await readFile(cacheFile, 'utf8'));
} catch {
  console.warn('bilibili/data/bilibili.json is missing, every member will be fetched from scratch.');
}
const previous = new Map((cache.members ?? []).map((entry) => [String(entry.uid), entry]));

let wbi = null;
if (!offline) {
  requestCookie = await collectCookies();
  try {
    wbi = await getWbiKeys();
  } catch (error) {
    warn(`Upload lists are skipped this run: ${error.message}`);
  }
  await sleep(REQUEST_GAP_MS);
}

const rows = [];
let failures = 0;
for (const member of members) {
  const uid = String(member.uid);
  const cached = previous.get(uid);
  const row = {
    uid,
    qq: member.qq ?? '',
    bilibili: cached?.bilibili ?? '',
    fans: cached?.fans ?? null,
    videos: cached?.videos ?? []
  };
  // Members whose upload list could not be refreshed last time carry a marker, so
  // that they are asked again first instead of waiting for their turn again.
  if (cached?.uploadRetryAt) row.uploadRetryAt = cached.uploadRetryAt;
  if (Number.isInteger(cached?.uploadTriedRun)) row.uploadTriedRun = cached.uploadTriedRun;

  if (!offline) {
    try {
      const account = await fetchAccount(uid, cached);
      row.bilibili = account.name ?? row.bilibili;
      row.fans = account.fans;
      console.log(`ok   ${uid.padEnd(18)} ${row.bilibili} -> ${row.fans}`);
    } catch (error) {
      failures += 1;
      console.warn(`fail ${uid.padEnd(18)} ${error.message}`);
    }
    await sleep(REQUEST_GAP_MS + Math.random() * 700);
  }

  rows.push(row);
}

// Uploads and tags come second, and they go first in line next time when they fail:
// whoever could not be refreshed (blocked, or skipped once the run gave up) carries an
// uploadRetryAt marker, and those markers are served before everybody else. The front
// of that waiting list moves on every run, so even a long block cannot starve anyone.
let videoFailures = 0;
let videoRefreshed = 0;
let videoSkipped = 0;
let blocked = 0;
let uploadRuns = Number.isInteger(cache.uploadRuns) ? cache.uploadRuns : 0;
if (!offline && wbi) {
  const waiting = rows.filter((row) => row.uploadRetryAt);
  const rest = rows.filter((row) => !row.uploadRetryAt);
  if (waiting.length > 0) {
    console.log(`uploads: ${waiting.length} member(s) still waiting, the least recently tried first.`);
  }
  // Never tried comes first, then whoever has been waiting the longest since the last
  // attempt: a run that gets refused still moves the queue forward for the next one.
  waiting.sort((a, b) => (a.uploadTriedRun ?? -1) - (b.uploadTriedRun ?? -1));
  const order = [...waiting, ...rotate(rest, Math.floor(Date.now() / 86400000))];
  for (const row of order) {
    if (blocked >= BLOCK_LIMIT) {
      videoSkipped += 1;
      row.uploadRetryAt = new Date().toISOString();
      continue;
    }
    row.uploadTriedRun = uploadRuns;
    try {
      const { videos, fresh } = await refreshVideos(row.uid, row.videos, wbi);
      row.videos = videos;
      delete row.uploadRetryAt;
      delete row.uploadTriedRun;
      blocked = 0;
      videoRefreshed += 1;
      console.log(`     uploads ${String(row.uid).padEnd(18)} ${videos.length} kept, tags fetched for ${fresh}`);
    } catch (error) {
      videoFailures += 1;
      row.uploadRetryAt = new Date().toISOString();
      if (isBlocked(error)) {
        blocked += 1;
        console.warn(
          `     uploads ${String(row.uid).padEnd(18)} blocked (${error.message}), will retry first next run`
        );
        await sleep(BLOCK_BACKOFF_MS * blocked);
      } else {
        console.warn(`     uploads ${String(row.uid).padEnd(18)} failed: ${error.message}, will retry first next run`);
      }
    }
    await sleep(UPLOAD_GAP_MS + Math.random() * UPLOAD_JITTER_MS);
  }
  // Count up only while somebody still owes us an upload list; once everybody is up to
  // date the numbering starts over, so the numbers never grow without meaning.
  uploadRuns = rows.some((row) => row.uploadRetryAt) ? uploadRuns + 1 : 0;
}

// A stamp is only meaningful while the member still owes us an upload list.
for (const row of rows) {
  if (!row.uploadRetryAt) delete row.uploadTriedRun;
}

// Most followers first; equal counts keep the order of members.json (Array#sort is stable).
rows.sort((a, b) => (b.fans ?? -1) - (a.fans ?? -1));

const fresh = !offline && failures < rows.length;
const updatedAt = fresh ? new Date().toISOString() : (cache.updatedAt ?? null);

const templateRaw = await readFile(templateFile, 'utf8');
if (!PLACEHOLDER.test(templateRaw)) throw new Error('bilibili/template.html has no {{BILI_TABLE}} placeholder');
if (!TOTAL_PLACEHOLDER.test(templateRaw)) throw new Error('bilibili/template.html has no {{BILI_TOTAL}} placeholder');

// Follow the template's line endings (the repository uses CRLF through .editorconfig),
// so that a rebuild really is a no-op when nothing changed.
const eol = templateRaw.includes('\r\n') ? '\r\n' : '\n';
const toEol = (text) => text.replaceAll('\n', eol);

await writeFile(
  cacheFile,
  toEol(
    `${JSON.stringify(
      {
        updatedAt,
        source: CARD_API,
        videoSource: SEARCH_API,
        tagSource: TAGS_API,
        uploadRuns,
        members: rows
      },
      null,
      2
    )}\n`
  ),
  'utf8'
);

const table = renderTable(rows, updatedAt);
const page = templateRaw
  .replaceAll('\r\n', '\n')
  .replace(new RegExp(`[ \\t]*${PLACEHOLDER.source}`), () => table)
  .replace(new RegExp(`[ \\t]*${TOTAL_PLACEHOLDER.source}`), () => renderTotal(rows))
  .replaceAll('\n', eol);
await writeFile(pageFile, page, 'utf8');

console.log(
  `${rows.length} members, ${failures} failed, updated at ${updatedAt ?? '(unknown)'}; bilibili.html written` +
    `${offline ? ' (offline mode)' : ''}.`
);

if (!offline && wbi) {
  console.log(
    `uploads: ${videoRefreshed} refreshed, ${videoFailures} failed, ${videoSkipped} skipped ` +
      `(the rest keep their cached uploads).`
  );
}

if (!offline && failures === rows.length) {
  fail('Every request failed. Bilibili risk control may be blocking this runner (try a BILI_COOKIE secret).');
  process.exitCode = 1;
} else if (!offline && failures > 0) {
  warn(
    `${failures} of ${rows.length} member accounts could not be refreshed this run; ` +
      'the cache keeps their previous values.'
  );
}

if (!offline && videoRefreshed === 0 && rows.length > 0) {
  warn(
    'No upload list could be fetched. Bilibili throttles that endpoint hard for anonymous ' +
      'callers; a BILI_COOKIE secret (your own SESSDATA) makes it far more reliable.'
  );
}
