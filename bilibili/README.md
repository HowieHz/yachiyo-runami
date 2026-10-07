# Bilibili Accounts Page

**EN** | [ZH](./README.zh-hans.md)

Take a look: [bilibili.html](../bilibili.html)～♪

A small generated page in the link corner that gathers everyone's Bilibili accounts: the current nickname, the UID, the follower count, and the QQ nickname, always sorted by follower count. The uploads behind those accounts are collected too, tags and all, so the little corner can talk about what everyone is making. Please take your time looking around～♪

## About This Little Page

- Everything is generated from `data/members.json` and `template.html`☆
- Nicknames are never written by hand. They are taken from Bilibili for the given UID, so a rename on Bilibili shows up on the page after the next run.
- The result is plain static HTML, so it opens directly in a browser. No build step or server is needed, just like `index.html`.
- Chinese, Japanese, Korean, and English are available, and `?lang=` works the same way as on the index page.

## Where Everything Lives

| File                   | Written by  | What it is                                                                |
| ---------------------- | ----------- | ------------------------------------------------------------------------- |
| `data/members.json`    | you         | The member list: `uid` and the QQ nickname to show.                       |
| `template.html`        | you         | The page itself, with `{{BILI_TABLE}}` and `{{BILI_TOTAL}}` placeholders. |
| `data/bilibili.json`   | `build.mjs` | The fetched nickname, follower count, and newest uploads with their tags. |
| `data/highlights.json` | you         | The tag words that earn an upload a ★ badge.                              |
| `../bilibili.html`     | `build.mjs` | The published page. Please do not edit it by hand.                        |

## Adding Or Removing A Member

Edit `data/members.json` and add a line:

```json
{ "members": [{ "uid": "5527780", "qq": "TsukijinH" }] }
```

- `uid` is the number in `https://space.bilibili.com/<uid>`, written as a string.
- `qq` is the nickname shown in the QQ group. Write `""` and the page shows `—` instead.
- The order in this file only breaks ties between equal follower counts.

Then run `npm run update:bilibili` to fetch everyone and rebuild the page.

## Updating The Page

Node.js 20 or later is required.

```bash
npm run update:bilibili          # fetch nicknames and follower counts, then rebuild the page
npm run update:bilibili:offline  # rebuild from the cache only, without network access
```

The script asks Bilibili once per member with a short random pause in between, and retries three times. When a request fails it keeps the cached nickname and follower count, so one bad run never empties the page.

## Newest Uploads And Their Tags

For every member the script also walks their uploads and keeps the ones that carry a highlighted tag, under `videos` in `data/bilibili.json`:

```json
{
  "bvid": "BV1L3aD6SEQj",
  "title": "…",
  "publishedAt": "2026-10-03T16:48:00.000Z",
  "tags": ["…", "…"]
}
```

It is built to stay small and to ask as little as possible:

- **A member is walked through their whole archive once** — for a new `uid`, or the first time the script ever sees them. Every upload is asked about exactly once, so "does this one carry our tag?" is answered for the whole archive, but **only the matching uploads are written to the cache**, so the file follows the tags and not the archive.
- After that, only uploads **newer than the stored watermark** (`"crawledUpTo"`) are looked at. A run costs one page request per member plus one request per new upload.
- The archive walk is resumable: `"crawledBackTo"` remembers how far down it got, and `"crawledAll"` is set once the whole archive has been walked. A tag request that fails stops the walk right there, so the next run picks it up again instead of losing the ground.
- Nobody logged in means the endpoints are throttled hard, so the requests are paced slowly, back off when they are refused, and are dropped for the rest of the run after two refusals in a row.
- **Whoever was refused is remembered**: a member whose upload list could not be refreshed keeps an `"uploadRetryAt"` marker and joins the **front of the queue next run**; the marker disappears as soon as the upload list comes back.
- Inside that queue the order comes from `"uploadTriedRun"`, the value of the run counter (`"uploadRuns"`) at the moment that member was last asked: never asked yet comes first, asked most recently comes last. Members that were skipped without being asked get no stamp, so even when Bilibili keeps saying no, the queue still moves forward and everybody gets a turn.
- Neither number just grows: a member that is up to date carries no `uploadRetryAt` and no `uploadTriedRun`, and once the whole queue is empty the counter starts over at 0.

Walking the whole group for the first time is the expensive part — around 2,800 uploads, so roughly an hour of pacing. Every run after that is a few dozen requests.

## Highlighted Tags

`data/highlights.json` lists the words that make an upload worth pointing at:

```json
{ "keywords": ["辉夜", "かぐや", "kaguya", "八千代", "ヤチヨ", "yachiyo", "彩叶", "彩葉", "酒寄"] }
```

- A tag counts when it **contains** one of the words (case-insensitive), so `辉夜` also covers `辉夜姬` and `超时空辉夜姬`.
- A member whose uploads carry such a tag gets a `★N` after their nickname: N is how many of **all** their cached matching uploads that is, and opening the badge lists the newest `BADGE_ITEM_LIMIT` (20) of them.
- Everyone else simply gets no badge, and nothing on the page moves because of this.
- Because matching is by substring, a word like `辉夜` also catches neighbouring works (Kaguya-sama tags, for instance). Delete it from the list if you would rather not see those.

## Daily Updates

[`../.github/workflows/update-bilibili-page.yml`](../.github/workflows/update-bilibili-page.yml) runs the script every day at 22:00 UTC (06:00 Asia/Shanghai) and commits the page and the cache when something changed☆ You can also start it by hand from the Actions tab.

- If Bilibili's risk control turns the runner down, the log shows `API code -352` or `-412` (or `HTTP 412`), the run fails without committing, and the page keeps its previous data. Adding a `BILI_COOKIE` repository secret — the value of your own Bilibili `SESSDATA` — makes the requests much more reliable. Please keep in mind that this value is a login credential, so a spare account is safer.
- The upload list is the fussiest of the requests. It is asked for twice: the app endpoint first, and the wbi-signed web endpoint (which also wants the `buvid` cookies) when the app one is unavailable. When both are turned down, that member simply keeps the uploads from the last successful run.
- GitHub pauses scheduled workflows after 60 days without repository activity. Starting a run by hand wakes it up again.
- The run commits the page and the cache, and then **asks the Pages workflow to deploy**: a push made with the built-in `GITHUB_TOKEN` does not start other workflows by itself, so the step ends with `gh workflow run pages.yml --ref main` to give the deployment a nudge. That is why this workflow asks for `actions: write`.
- The few lines worth a human look — risk control, accounts that could not be refreshed — are printed as GitHub annotations (`::warning::` / `::error::`), so they surface on the run itself instead of being buried in the log. Everything else stays ordinary text, and a local run prints all of it as plain warnings and errors.

## Where The Numbers Come From

- Nickname and follower count: `GET https://api.bilibili.com/x/web-interface/card?mid=<uid>` → `data.card.name`, `data.follower`.
- Follower count only, as a fallback: `GET https://api.bilibili.com/x/relation/stat?vmid=<uid>` → `data.follower`.
- Newest uploads, primary: `GET https://app.bilibili.com/x/v2/space/archive/cursor?vmid=<uid>&ps=10&mobi_app=android` → `data.item[]` (`bvid`, `title`, `ctime`). It is signed with the app key the official Android app uses, and it answers even while the web endpoint is being refused.
- Newest uploads, fallback: `GET https://api.bilibili.com/x/space/wbi/arc/search?mid=<uid>&ps=10&pn=1&order=pubdate` (wbi-signed, `data.list.vlist`). Set `BILI_WEB_ONLY=1` to skip the app endpoint and only use this one.
- Tags of one upload: `GET https://api.bilibili.com/x/tag/archive/tags?bvid=<bvid>` → `data[].tag_name`.

All of them are public endpoints that need no login, but they are not a promised API contract, so the script treats a failure as "keep the old value" rather than "this member has no data".

## Feedback And Link Suggestions

Please send corrections or a little message through [GitHub Issues](https://github.com/HowieHz/yachiyo-runami/issues)～!
