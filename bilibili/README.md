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

| File                 | Written by  | What it is                                                                |
| -------------------- | ----------- | ------------------------------------------------------------------------- |
| `data/members.json`  | you         | The member list: `uid` and the QQ nickname to show.                       |
| `template.html`      | you         | The page itself, with `{{BILI_TABLE}}` and `{{BILI_TOTAL}}` placeholders. |
| `data/bilibili.json` | `build.mjs` | The fetched nickname, follower count, and newest uploads with their tags. |
| `../bilibili.html`   | `build.mjs` | The published page. Please do not edit it by hand.                        |

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

For every member the script also keeps the newest uploads and the tags of those uploads, under `videos` in `data/bilibili.json`:

```json
{
  "bvid": "BV1L3aD6SEQj",
  "title": "…",
  "publishedAt": "2026-10-03T16:48:00.000Z",
  "tags": ["…", "…"]
}
```

It is built to stay small and to ask as little as possible:

- Only the newest `VIDEO_LIMIT` (10) uploads of a member are kept, so neither the file nor a run grows with the archive.
- Tags are fetched only for videos that are not in the cache yet. The upload list comes back newest first, so **as soon as a known bvid shows up, the rest of that member is already cached and the requests stop right there** — usually after one request.
- In the steady state a run costs one upload-list request per member, nothing more. A brand new video costs exactly one extra request.
- A tag request that fails is stored as `"tags": null` and tried again on the next run, so nothing stays empty by accident.
- Nobody logged in means the upload list and the tag pages are throttled hard, so those two are paced slowly (about five seconds per member), back off when they are refused, and are dropped for the rest of the run after two refusals in a row. The order starts at a different member every day, so whoever was skipped is at the front tomorrow.

## Daily Updates

[`../.github/workflows/update-bilibili-page.yml`](../.github/workflows/update-bilibili-page.yml) runs the script every day at 22:00 UTC (06:00 Asia/Shanghai) and commits the page and the cache when something changed☆ You can also start it by hand from the Actions tab.

- If Bilibili's risk control turns the runner down, the log shows `API code -352` or `-412` (or `HTTP 412`), the run fails without committing, and the page keeps its previous data. Adding a `BILI_COOKIE` repository secret — the value of your own Bilibili `SESSDATA` — makes the requests much more reliable. Please keep in mind that this value is a login credential, so a spare account is safer.
- The upload list is behind that same risk control, and it is the fussiest of the requests: it needs a wbi signature plus the `buvid` cookies the front page hands out. When it is turned down, that member simply keeps the uploads from the last successful run.
- GitHub pauses scheduled workflows after 60 days without repository activity. Starting a run by hand wakes it up again.

## Where The Numbers Come From

- Nickname and follower count: `GET https://api.bilibili.com/x/web-interface/card?mid=<uid>` → `data.card.name`, `data.follower`.
- Follower count only, as a fallback: `GET https://api.bilibili.com/x/relation/stat?vmid=<uid>` → `data.follower`.
- Newest uploads: `GET https://api.bilibili.com/x/space/wbi/arc/search?mid=<uid>&ps=10&pn=1&order=pubdate` (wbi-signed, `data.list.vlist`).
- Tags of one upload: `GET https://api.bilibili.com/x/tag/archive/tags?bvid=<bvid>` → `data[].tag_name`.

All of them are public web endpoints that need no login, but they are not a promised API contract, so the script treats a failure as "keep the old value" rather than "this member has no data".

## Feedback And Link Suggestions

Please send corrections or a little message through [GitHub Issues](https://github.com/HowieHz/yachiyo-runami/issues)～!
