<p align="center">
  <img src="assets/readme/hero-en.png" width="100%" alt="Peak Distance: understand a new language, keep the context. Look up words, save sentences and review them across the web, X and YouTube.">
</p>

# Peak Distance

**Every word you look up stays with its sentence.**

Peak Distance is a browser extension for language learning. While reading web pages, scrolling X or watching YouTube, you can look up words, translate, and save the expressions you want to remember together with the sentence they appeared in. When you review, you return to where each one came from; your learning records can also be saved as local files and organized further in note apps like Obsidian.

It supports many languages beyond English. You choose the language used for translations and explanations, then filter your vocabulary book by language.

The interface supports Simplified Chinese, Traditional Chinese, English, German and French, or follows your browser. Choose **Settings → Languages → Display language**. AI chat answers use the active display language; definitions and translations use the separate **Explanation language** setting.

[中文](README.md) · [Download](https://github.com/Rayyy3320/peak-distance/releases/latest) · [Installation](#installation) · [Usage](#usage) · [Privacy & Services](#privacy--services) · [License](#license)

## Installation

Requires desktop **Chrome 142 or newer**. The current release is [v0.6.8](https://github.com/Rayyy3320/peak-distance/releases/tag/v0.6.8).

This README describes main-branch features, which may be newer than the release above. Download installable packages from Releases.

1. Download the package whose name ends with `-chrome.zip` from [Releases](https://github.com/Rayyy3320/peak-distance/releases/latest) and unzip it into a fixed folder.
2. Type `chrome://extensions` in Chrome's address bar and turn on **Developer mode** (开发者模式) in the top-right corner.
3. Click **Load unpacked** (加载已解压的扩展程序) and select the folder that contains `manifest.json`.

No Node.js and no commands needed. After installing, pin Peak Distance to the toolbar and refresh open pages to start selecting words. Keep the unzipped folder — the extension still reads from it at runtime.

<details>
<summary>Build from source</summary>

Prepare Node.js 22+ and npm. After downloading the source, run in the project directory:

```sh
npm ci
npm run build
```

Then load `.output/chrome-mv3` following the steps above. During development you can use `npm run dev`. For ordinary changes, select the necessary checks based on the affected scope and risk; `npm run verify-local` provides local checks across modules. For releases, follow ROADMAP's release instructions. When browser regression checks are needed, run `npx playwright-core install chromium` before the first run. After rebuilding, reload the extension and refresh the target pages.

See the repository's [ARCHITECTURE](https://github.com/Rayyy3320/peak-distance/blob/main/docs/ARCHITECTURE.md) for code entry points and [ROADMAP](https://github.com/Rayyy3320/peak-distance/blob/main/docs/ROADMAP.md) for tasks, known defects and Git/release conventions (both in Chinese). `npm run zip:source` archives the current HEAD using `.gitattributes`; release source archives use the matching version tag.

</details>

## Usage

### Reading the web: look up words, keep the sentence

Select a word or phrase and click **Look up** (查词); select a sentence or paragraph and click **Translate** (翻译). When you save an expression, its original sentence and source are kept too.

For example, reading “She is comfortable **with** people.” and saving **with** means later reviews still show this sentence — you are not left recalling an isolated word.

The **Add to chat** (加入对话) bubble next to the selection brings content into the AI chat. Words and phrases are attached together with their sentence; for a sentence or paragraph, the selected text itself is attached. Your existing draft is never replaced, and no AI request is made until you click send.

### Watching videos: keep the original, replay line by line

Open a YouTube video with subtitles and read the bilingual subtitles below the player. The extension follows the video's current original-caption track; the language of the translation is up to your settings.

Hover a word in the subtitles to see its meaning and pause playback; click to expand the word card. You can also drag to select phrases and save full sentences. Selections in the player subtitles and in the learning panel's subtitle list can both be added to the chat.

**Subtitles → Original language** (字幕设置 → 原文语言) at the bottom of the player selects among the tracks the video provides; you can also switch via YouTube's native **Settings → Subtitles/CC**. The same menu adjusts the translation mode, translation display and font size. With **Pause after each line** on, the video pauses at the end of each subtitle line; the learning panel also offers previous, replay and next for repeating a passage.

### Learning different languages: pick explanations you understand

In **Settings → Languages** (设置 → 语言设置), choose the default **Explanation language** — the language you want translations and word explanations in. You can also set a language pair individually, for example understanding English via Chinese, or Japanese via English.

Expressions from web pages and videos go into the same vocabulary book (生词本). The language filter at the top of the vocabulary book shows records for one language at a time, where you can adjust the **Saved / Learning / Known** (已收藏／学习中／已掌握) status or start sentence review.

Different language pairs have different lookup sources. English to Chinese prefers online dictionaries; other combinations may use regular translations. Word cards show their source; when a language cannot be determined it is marked **Unconfirmed** (待确认) instead of assuming everything is English.

### Keeping it local: your learning records in your own folder

In **Settings → Shared files** (设置 → 文件共享), click **Choose folder** (选择位置) and pick a local directory. Vocabulary, sentences, notes, language preferences and your saved chat history are stored as Markdown — plain note files any text editor can open. You can also pick a folder inside an Obsidian vault.

When you change an entry's status or **My notes** (我的笔记) in Obsidian, the extension reads those changes back. Chrome and Edge on the same computer can connect to the same directory and share learning records; conflicting edits to the same field of a vocabulary or sentence record keep both versions and report a conflict.

Words are kept in `生词本.md` (vocabulary) and sentences in `句子.md` (sentences), one section per record; AI chats are still saved per conversation. Recovery data such as full definitions and video positions lives in the `.peak-distance` helper directory, which also keeps a backup when migrating older scattered files. Please keep the whole learning folder.

After updating the extension on both browsers, connect the same folder in each and click **Sync now** (立即同步). Syncing writes local changes first, then reads back what the other browser wrote; switching back to a browser also reads the shared files. Insufficient permissions, corrupted files and conflicts are reported clearly; uncommitted content stays on the machine where it was made.

This release fixes chat material/citation recovery, deleted chats reappearing, pending writes crossing vaults, language preference updates and leftover state after a window closes. Native shared-folder permission recovery and simultaneous writes across applications still need real-world verification. See the repository's [ROADMAP](https://github.com/Rayyy3320/peak-distance/blob/main/docs/ROADMAP.md) for details and repair status (in Chinese).

The extension works without connecting a folder — records stay in the browser extension. Disconnecting the vault never deletes existing files, and API keys and AI service settings are never written into it.

### Using AI: ask with the original text attached

In **Settings → AI services** (设置 → AI 服务), pick a provider, enter your API key and click **Save and use** (保存启用). Presets include DeepSeek, OpenAI, Anthropic, Gemini, Zhipu GLM and Kimi; other compatible services can be configured in advanced settings with their address, model and API format.

Ask questions directly, or attach a page, a selection or subtitles. Attached material is shown above the input box — click to view it in full, and removing it keeps your typed question. **Ask about this** (继续提问) in a word card brings in the expression and its sentence first; you decide whether to send.

**Regular lookups and translations need no API key.** Configuring a key never switches translation to AI automatically. If you also enable **Use AI when needed** (查词补充), an AI explanation is attempted only when you actively look a word up, no applicable dictionary or a clear no-result applies, and AI is configured. Hover previews never trigger it, and neither do dictionary network failures.

## Privacy & Services

- Learning records are stored in the browser extension by default, or shared through a local folder when a learning vault is connected. The extension has no accounts and no built-in cloud sync.
- API keys and AI service settings stay in the current browser and are never written into the Markdown vault. Another browser sharing the same vault configures its own AI services.
- Online lookups and translations send the needed text to the corresponding service; AI requests send your question and attached material. Availability, model access and costs depend on your configuration and provider.
- Sentence review reads existing records and never issues AI requests.

## FAQ

**Is unsent content kept forever?**

No. Input, material and citations survive switching between the docked sidebar and the floating panel; closing the panel or switching conversations discards unsent content. A new conversation enters history only after its first send, and temporary input is never written to the learning vault.

**Why do some lookups return no definition or translation?**

Dictionary coverage differs by language, and translation services can be affected by network or rate limits. Retry, switch sources, or use AI when needed. A failed lookup never prevents saving the expression and its sentence.

**Are videos without subtitles supported?**

The extension relies on YouTube's existing subtitles. It does not capture audio or generate subtitles for videos without them. Shorts, live streams and Netflix are not supported yet.

**How do I update?**

Unzip the new package into the original installation folder, replacing the files, click **Reload** (重新加载) for Peak Distance in `chrome://extensions`, then refresh the pages using the extension. Do not uninstall first — uninstalling deletes the extension's local data in the browser.

**Why is there no lookup entry after installing?**

Refresh the page first, then check that the extension's **Site access** (网站访问) allows the current site.

## License

[MIT](LICENSE)
