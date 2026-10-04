# 群友哔哩哔哩账号页

[EN](./README.md) | **ZH**

来看看吧：[bilibili.html](../bilibili.html)～♪

这是链接小角落里一个自动生成的小页面，把群友的哔哩哔哩账号聚在一起：当前昵称、UID、粉丝数和 QQ 昵称，并且一直按粉丝数从多到少排好。这些账号最新的投稿和标签也会一起收下来，方便聊大家都在做什么。欢迎慢慢逛～♪

## 关于这个小页面

- 整个页面由 `data/members.json` 和 `template.html` 生成☆
- 哔哩哔哩昵称不用手填，而是按 UID 从哔哩哔哩取回来，所以在哔哩哔哩改了名，下一次运行后页面就会跟着变。
- 生成结果是静态 HTML，直接用浏览器打开就能看，不需要构建或服务器，和 `index.html` 一样。
- 支持中文、日文、韩文和英文，`?lang=` 的用法与首页一致。

## 各个文件放在哪里

| 文件                 | 谁写的      | 作用                                                              |
| -------------------- | ----------- | ----------------------------------------------------------------- |
| `data/members.json`  | 你          | 群友名单：`uid` 和要展示的 QQ 昵称。                              |
| `template.html`      | 你          | 页面本体，表格和总数位置留了 `{{BILI_TABLE}}`、`{{BILI_TOTAL}}`。 |
| `data/bilibili.json` | `build.mjs` | 抓回来的昵称、粉丝数，以及最新投稿和它们的标签。                  |
| `../bilibili.html`   | `build.mjs` | 真正发布的页面，请不要手改。                                      |

## 加人 / 删人

改 `data/members.json`，加上一行：

```json
{ "members": [{ "uid": "5527780", "qq": "TsukijinH" }] }
```

- `uid` 就是 `https://space.bilibili.com/<uid>` 里的那串数字，请写成字符串。
- `qq` 是在 QQ 群里显示的昵称，写 `""` 就会显示 `—`。
- 这个文件里的顺序只在粉丝数相同时决定谁排在前面。

然后运行 `npm run update:bilibili`，就会重新抓取并生成页面。

## 更新页面

需要 Node.js 20 或更高版本：

```bash
npm run update:bilibili          # 联网抓昵称和粉丝数，再重新生成页面
npm run update:bilibili:offline  # 只用缓存重新生成，不联网
```

脚本对每位群友只发一次请求，请求之间会随机停一小会儿，失败会重试三次；还是失败就沿用上一次的昵称和粉丝数，所以偶尔一次失败不会把页面清空。

## 最新投稿与标签

每位群友最新的投稿和它们的标签，会收在 `data/bilibili.json` 的 `videos` 里：

```json
{
  "bvid": "BV1L3aD6SEQj",
  "title": "…",
  "publishedAt": "2026-10-03T16:48:00.000Z",
  "tags": ["…", "…"]
}
```

这一块专门为「省流量、省体积」设计：

- 每位群友只留最新 `VIDEO_LIMIT`（10 条）投稿，文件不会随着投稿历史越滚越大。
- 只给**缓存里还没有**的视频抓标签。投稿列表是按时间从新到旧返回的，所以**一遇到已经缓存过的 bv 号，说明再往下的都已经有了，这一位就直接收工、不再发请求**——通常只花一次请求。
- 稳定状态下，每天每位群友只花一次「投稿列表」请求，没有别的开销；刚好发了新视频时，才多花一次标签请求。
- 标签抓取失败的会存成 `"tags": null`，下一次运行再补，不会一直空着。
- 没有登录的情况下，投稿列表和标签页被限得很死，所以这两个请求放得很慢（每位约五秒），被拒绝就退避，连续被拒两次就整个运行都不再问它了。
- **被拒的人会被记下来**：投稿列表没能刷新的群友会在缓存里留下 `"uploadRetryAt"` 标记，下一次运行进入**队伍最前面**；抓到之后标记自动消失。
- 队伍内部的先后由 `"uploadTriedRun"` 决定 —— 它就是「上次问这个人时，缓存里的运行计数器（`"uploadRuns"`）是多少」：从没问过的排最前，刚问过的排最后。被跳过、根本没发请求的人不会盖上这个戳记，所以就算风控一直不放行、每轮只塞得进两个人，队列也会继续往前推进，人人都轮得到。
- 这两个数字都不会无限膨胀：已经补齐的人身上既没有 `"uploadRetryAt"` 也没有 `"uploadTriedRun"`；整支队伍清空之后，计数器会重新从 0 开始。

## 每天自动更新

[`../.github/workflows/update-bilibili-page.yml`](../.github/workflows/update-bilibili-page.yml) 每天 22:00 UTC（北京时间次日 06:00）运行脚本，有变化就自动提交页面和缓存☆ 也可以在 Actions 页面手动点一次运行。

- 如果哔哩哔哩的风控拒绝了 GitHub 的机器，日志里会出现 `API code -352` 或 `-412`（或 `HTTP 412`），这次运行会失败且不会提交，页面保持上一次的数据。这时可以在仓库 Secrets 里加一个 `BILI_COOKIE`（值是你自己哔哩哔哩的 `SESSDATA`）来提高成功率。这个值是登录凭证，用小号会更安心。
- 投稿列表也在同一套风控后面，而且是所有请求里最挑的一个：它需要 wbi 签名，还要首页发下来的 `buvid` cookie。被拦下来时，这位群友就继续沿用上一次成功抓到的投稿。
- GitHub 在仓库连续 60 天没有活动后会暂停定时任务，手动跑一次就能恢复。

## 数据来源

- 昵称和粉丝数：`GET https://api.bilibili.com/x/web-interface/card?mid=<uid>` → `data.card.name`、`data.follower`。
- 只补粉丝数的备用接口：`GET https://api.bilibili.com/x/relation/stat?vmid=<uid>` → `data.follower`。
- 最新投稿：`GET https://api.bilibili.com/x/space/wbi/arc/search?mid=<uid>&ps=10&pn=1&order=pubdate`（需要 wbi 签名，结果在 `data.list.vlist`）。
- 单条投稿的标签：`GET https://api.bilibili.com/x/tag/archive/tags?bvid=<bvid>` → `data[].tag_name`。

这些都是公开的网页接口，不需要登录，但并不是官方承诺稳定的 API，所以脚本把失败当成「保留旧数据」，而不是「这个人没有数据」。

## 反馈与链接

发现错误或者想留句话，可以前往 [GitHub Issues](https://github.com/HowieHz/yachiyo-runami/issues)～♪
