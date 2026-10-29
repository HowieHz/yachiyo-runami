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

| 文件                   | 谁写的      | 作用                                                              |
| ---------------------- | ----------- | ----------------------------------------------------------------- |
| `data/members.json`    | 你          | 群友名单：`uid` 和要展示的 QQ 昵称。                              |
| `template.html`        | 你          | 页面本体，表格和总数位置留了 `{{BILI_TABLE}}`、`{{BILI_TOTAL}}`。 |
| `data/bilibili.json`   | `build.mjs` | 抓回来的昵称、粉丝数，以及最新投稿和它们的标签。                  |
| `data/highlights.json` | 你          | 能让投稿挂上 ★ 徽章的标签词。                                     |
| `../bilibili.html`     | `build.mjs` | 真正发布的页面，请不要手改。                                      |

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

每位群友的投稿会被走一遍，凡是带上指定标签的，记在 `data/bilibili.json` 的 `videos` 里：

```json
{
  "bvid": "BV1L3aD6SEQj",
  "title": "…",
  "publishedAt": "2026-10-03T16:48:00.000Z",
  "tags": ["…", "…"]
}
```

这一块专门为「省流量、省体积」设计：

- **每位群友会把全部投稿走一遍**（第一次见到这个 uid，或者 `members.json` 里新加的人）。每条投稿都只问一次标签，所以「这条有没有我们的标签」在整个投稿历史里都有答案；但**只有命中的投稿会写进缓存**，文件跟着标签走，不跟着投稿历史膨胀。
- 之后只看**比水位线（`"crawledUpTo"`）更新的投稿**：稳定状态下，每天每位群友只花一次列表请求，加上「新投稿条数」次标签请求。
- 首次走全量可以中断续跑：`"crawledBackTo"` 记住走到了哪一条，全部走完则记上 `"crawledAll"`。某个标签请求失败时，游标就停在它前面不动，下一次接着来，不会白走。
- **投稿列表会漏东西**。收进合集（`ugc_season`）的投稿、以及被「防刷屏」折叠掉的投稿，在列表里根本不出现，**连 `count` 也不算它们**，所以只比对数量是发现不了的。因此走档时会额外问一遍每个人的合集（`polymer/web-space/seasons_series_list` 与 `seasons_archives_list`），里面的投稿按正常流程处理。每个合集只记住条数（`"collections": { "<season_id>": <total> }`），没变过的合集下次就不再问。
- 走档结果还会和接口报的投稿总数对账：拿回来的比档案声称的少时，运行时会打出警告。
- 没有登录的情况下这些接口被限得很死，所以请求放得很慢，被拒绝就退避，连续被拒两次就整个运行都不再问它了。
- **被拒的人会被记下来**：投稿列表没能刷新的群友会在缓存里留下 `"uploadRetryAt"` 标记，下一次运行进入**队伍最前面**；抓到之后标记自动消失。
- 队伍内部的先后由 `"uploadTriedRun"` 决定 —— 它就是「上次问这个人时，缓存里的运行计数器（`"uploadRuns"`）是多少」：从没问过的排最前，刚问过的排最后。被跳过、根本没发请求的人不会盖上这个戳记，所以就算风控一直不放行，队列也会继续往前推进，人人都轮得到。
- 这两个数字都不会无限膨胀：已经补齐的人身上既没有 `"uploadRetryAt"` 也没有 `"uploadTriedRun"`；整支队伍清空之后，计数器会重新从 0 开始。

首次把全群走一遍是最费的一次 —— 约 2800 条投稿，按现在的节奏大约一小时；之后每次运行的代价就是下面这张表。

### 强制重爬某个人

```bash
node bilibili/build.mjs --force 196698970          # 或者：BILI_FORCE_UIDS=196698970 npm run update:bilibili
node bilibili/build.mjs --force 196698970,5527780  # 一次指定多个人
node bilibili/build.mjs --force all                # 全部重爬
```

被强制的人会丢掉水位线、已保留的投稿和合集条数，排到队首，整个投稿历史重新问一遍 —— 发现某个人的数据不对时用它。**改标签清单必须用 `all`**：以前在旧清单下被丢弃的投稿，得重新问一遍标签才有机会被重新判进来。在 Actions 里手动跑 workflow 时，就是那个 `force_uids` 输入框。

### 一次运行要多少请求

37 人的日常运行大约 **112 发**：

| 请求                    | 什么时候发                                                                 | 每轮次数   |
| ----------------------- | -------------------------------------------------------------------------- | ---------- |
| 访问首页                | 一次，为了拿 `buvid` cookie                                                | 1          |
| `card`                  | 昵称和粉丝数                                                               | 每人 1     |
| 投稿列表第 1 页         | 水位线以上的新投稿                                                         | 每人 1     |
| 合集目录                | 每人每轮都问 —— 某人开始建合集的当天，恰恰就是他投稿可能从列表里消失的那天 | 每人 1     |
| `seasons_archives_list` | 只有某个合集的条数变了才发                                                 | 少见       |
| 单条投稿的标签          | 每条投稿一辈子只问一次                                                     | 只有新投稿 |

日志末尾会打印实际数字（`requests: 112 in total.`），设 `BILI_DEBUG_REQUESTS=1` 还能看到每个人各花了多少发。有一件事是故意不省的：合集条数一变就会把整个合集重走一遍（B 站不告诉你是哪一条新加的）；缓存里没有某人的记录时会从头走。

## 指定标签

`data/highlights.json` 里放的是**逐条对应**的标签名：

```json
{ "tags": ["超时空辉夜姬", "超时空辉夜姬！", "八千代", "月见八千代", "彩叶", "酒寄彩叶", "yachiyo"] }
```

- 判定方式是**整条标签相等**，不是包含：`八千代` 算命中，`月见八千代` 因为单独列了也算，但 `八千代と私` 不算。两边都会先归一化（NFKC + 转小写），所以全角 `！` 和半角 `!` 视为同一个，`Yachiyo` 也等同于 `yachiyo`。
- 投稿带这类标签的群友，昵称后面会挂一个 `★N`：N 是 TA **全部**命中投稿的条数。点开按时间从新到旧列出，每次 `BADGE_PAGE_SIZE`（20）条：所有条目都在 HTML 里，第一页之后的藏在「展开更多」那一行后面，点一次再放出 20 条。关掉 JS 时什么都不隐藏，等于一次列全。
- 其他人不显示徽章，页面也不会因为他们而移位。
- 以前是包含匹配、字段名也叫 `keywords`；那个写法现在仍然认。

### 专栏

群友的专栏也会爬，并**算进同一个 `★N`**：

- `GET https://api.bilibili.com/x/space/wbi/article?mid=<uid>&pn=<页>&ps=10&order=pubdate`（wbi 签名，返回 `data.articles[]` 与 `data.count`）。列表里已经带标题和 id，所以专栏**不需要逐条请求**；链接是 `https://www.bilibili.com/read/cv<id>`。
- 专栏**没有标签**，所以同一份词表改为对**标题 + 摘要**做子串匹配 —— 比标签的整条相等松。**单字关键词不参与**专栏匹配：`雷` 会把每一篇提到打雷的《饥荒》专栏都命中。
- 展开列表里投稿和专栏按时间混排，专栏那一行以 `📄` 开头。
- 某人的专栏条数没变时，每轮只花 1 次请求；条数或词表变了才重新走一遍列表。

## 每天自动更新

[`../.github/workflows/update-bilibili-page.yml`](../.github/workflows/update-bilibili-page.yml) 每天 22:00 UTC（北京时间次日 06:00）运行脚本，有变化就自动提交页面和缓存☆ 也可以在 Actions 页面手动点一次运行。

- 如果哔哩哔哩的风控拒绝了 GitHub 的机器，日志里会出现 `API code -352` 或 `-412`（或 `HTTP 412`），这次运行会失败且不会提交，页面保持上一次的数据。这时可以在仓库 Secrets 里加一个 `BILI_COOKIE`（值是你自己哔哩哔哩的 `SESSDATA`）来提高成功率。这个值是登录凭证，用小号会更安心。
- 投稿列表是所有请求里最挑的一个，所以要问两次：先问 App 接口，App 接口不行再问需要 wbi 签名（还要首页发下来的 `buvid` cookie）的网页接口。两个都被拒时，这位群友就继续沿用上一次成功抓到的投稿。
- GitHub 在仓库连续 60 天没有活动后会暂停定时任务，手动跑一次就能恢复。
- 这次运行会提交页面和缓存，然后**主动叫一次 Pages workflow 来部署**：用内置 `GITHUB_TOKEN` 推送的提交不会自动触发别的 workflow，所以最后一步用 `gh workflow run pages.yml --ref main` 推一下部署。这也是这个 workflow 需要 `actions: write` 权限的原因。
- 值得人看一眼的几行 —— 风控、没刷新到的账号 —— 会输出成 GitHub 的 `::warning::` / `::error::` 标注，直接在 Actions 页面上带图标显示，不用去翻日志；其余明细仍是普通文本，本地运行时全部按普通的 warning / error 打印。

## 数据来源

- 昵称和粉丝数：`GET https://api.bilibili.com/x/web-interface/card?mid=<uid>` → `data.card.name`、`data.follower`。
- 只补粉丝数的备用接口：`GET https://api.bilibili.com/x/relation/stat?vmid=<uid>` → `data.follower`。
- 最新投稿（主）：`GET https://app.bilibili.com/x/v2/space/archive/cursor?vmid=<uid>&ps=10&mobi_app=android` → `data.item[]`（`bvid`、`title`、`ctime`）。它用官方 App 的 appkey 签名，网页接口被拒的时候它往往还能用。
- 最新投稿（备）：`GET https://api.bilibili.com/x/space/wbi/arc/search?mid=<uid>&ps=10&pn=1&order=pubdate`（需要 wbi 签名，结果在 `data.list.vlist`）。设 `BILI_WEB_ONLY=1` 可以跳过 App 接口、只用这个。
- 单条投稿的标签：`GET https://api.bilibili.com/x/tag/archive/tags?bvid=<bvid>` → `data[].tag_name`。
- 某人的合集：`GET https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid=<uid>&page_num=1&page_size=20` → `data.items_lists.seasons_list[].meta`（`season_id`、`name`、`total`）。`page_size` 最大 20，写 30 会返回 `-400`。
- 某个合集里的投稿：`GET https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=<uid>&season_id=<id>&page_num=1&page_size=30` → `data.archives[]`（`bvid`、`title`、`pubdate`）以及 `data.page.total`。

这些都是公开接口，不需要登录，但并不是官方承诺稳定的 API，所以脚本把失败当成「保留旧数据」，而不是「这个人没有数据」。

## 反馈与链接

发现错误或者想留句话，可以前往 [GitHub Issues](https://github.com/HowieHz/yachiyo-runami/issues)～♪
