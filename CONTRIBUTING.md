# Contributing To Yachiyo's Link Corner

**EN** | [ZH](./CONTRIBUTING.zh-hans.md)

Thanks for stopping by～! Even a small correction helps a lot☆

## Before Editing

- Verify website names, URLs, rankings, and editorial notes against their source.
- Keep official titles and proper names intact. Do not invent translations or turn a quality ranking into a personal preference ＞＜
- Keep the four locales (`zh`, `ja`, `ko`, and `en`) aligned when changing visible copy or SEO descriptions.
- Keep this a simple personal site. Please do not add a framework or build step.

## Check Your Changes

Use Node.js 20 or later, then run:

```bash
npm install
npm run fmt
npm run check
```

When changing language behavior, open each URL in a browser:

```text
?lang=zh
?lang=ja
?lang=ko
?lang=en
```

## Feedback And Links

Send corrections, link suggestions, or a little message through [GitHub Issues](https://github.com/HowieHz/yachiyo-runami/issues)～♪
