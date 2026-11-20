import { createSubtitleBoundaryHost } from '@/shared/subtitleBoundaries';
import { SUBTITLE_FALLBACK_NOTICE, SUBTITLE_READER_PORT, type SubtitleReaderDemand } from '@/shared/messages';
import { t as tr, localize, onDisplayLanguageChange, setDisplayLanguage , message, setText, setLocalizedAttribute, type UiText } from '@/shared/i18n';
import { initFloatingPanel } from '@/shared/floatingPanel';
import { createTranslationPopup } from '@/shared/translationPopup';
import { shadowSelection, classifyRangeIn, clampRangeToElement } from '@/shared/selection';
import { applyAppearance, initAppearance } from '@/shared/appearance';
import { brandTokens, brandControls, sharedControls, CHAT_ADD_ICON } from '@/shared/brand';
import selectionActionStyles from '@/shared/selectionActions.css?inline';
import { uiIcon } from '@/shared/uiControls';
import { detectTextLanguage } from '@/shared/tokenize';
import { sendRuntime } from '@/shared/runtime';
import { createSelectionPill } from '@/shared/selectionPill';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import type { Settings } from '@/shared/settings';
// YouTube 隔离世界：字幕、页内学习侧栏、查词与播放控制。
//
// 职责（M0 嗅探链路之上）：
//   1. 与 MAIN world 嗅探脚本互通，展示可用轨道并提交选轨意图；
//   2. 用 video.currentTime 定位源轨块，按原文范围读取对应学习句译文，
//      暂停 / 拖动 / 倍速后按时间重新定位；
//   3. 常规中文优先轨道 / 平台 / Google；显式 AI 按当前窗口小批量请求。
//      字幕 ID 对齐，显示开关保留缓存；换视频 / 换轨 / 隐藏时取消旧任务。
//   4. 悬停 / 点击字幕词就地查释义（拖选短语优先），复用共用弹窗与存储；
//      查词暂停播放，关闭时仅恢复由本次查词暂停且仍是同一视频的播放；
//      页面正文（描述 / 评论 / 标题）选区由共用浮条提供 查词/翻译/添加到
//      对话（shared/selectionPill.ts），字幕栏内选区仍走本脚本操作条；
//   5. 侧栏直达消息：字幕视图状态（blc-sub-get）与播放控制
//      （blc-sub-control，携带 videoId 防串页）；
//   6. 诊断徽标默认隐藏（页面事件 blc-debug-toggle 切换），宿主属性
//      data-blc-* 持续更新供程序化断言。
//
// 沿用 Gythiro yt-dual-subs（MIT）的获取链路思路，见 docs/REFERENCES.md。

import { videoIdFromLocation } from '@/shared/youtube';
import { captionTrackOf, trackOfUrl, type SubtitleTrack as TrackInfo } from '@/shared/subtitleTracker';
import {
  CONTENT_SOURCE,
  INJECT_SOURCE,
  formatCue,
  type Cue,
  type InjectMessage,
  type LearningCue,
  type SourceFragment,
} from '@/shared/protocol';
import { blockPauseOffsets, cueIndexAt, fmtClock, DISPLAY_CUE_VERSION } from '@/shared/cues';
import { buildSubtitleUnits, joinSubtitleLines, platformLineForPart, type DisplayUnit } from '@/shared/subtitleLines';
import type { SubtitleTranslationItem, SubtitleTranslationRecord, SubtitleTranslationReply } from '@/shared/messages';
import { subtitleFontSize } from '@/shared/youtubeWorkspace';
import { createLookupPopup } from '@/shared/lookupPopup';
import {
  videoContextUrl,
  type VocabIndexItem,
  type VideoSnapshot,
} from '@/shared/vocab';
import { buildMarkBuckets, type MarkBucket } from '@/shared/marker';
import { appendSubtitleText } from '@/shared/subtitleText';
import { normalizeExpressionInLanguage, langDisplayName } from '@/shared/languages';
import {
  materialFromCandidate,
  sourceKeyOf,
  type MaterialPayload,
  type SelectionCandidate,
  type SourceDescriptor,
} from '@/shared/chat';
import type { ChatSourceInfo, SubControlMessage, SubtitleRowAction, SubViewState, VideoSettingsState, VideoSettingsCommand } from '@/shared/messages';

const SUBS_ID = 'blc-subs';
const SWITCH_ID = 'blc-subs-switch';
const BADGE_ID = 'blc-debug';
const NATIVE_CAPTIONS_HIDE_STYLE_ID = 'blc-hide-native-captions';
// 全屏字幕栏定位（整体赋值，防止随字幕重绘追加增长；--blc-font 单独 setProperty）
const SUBS_FULLSCREEN_CSS = 'position:absolute;left:4%;right:4%;bottom:76px;z-index:60;';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    initAppearance();
    onDisplayLanguageChange(()=>{
      for(const id of [SUBS_ID,SWITCH_ID,'pd-phrase-actions']) {const root=document.getElementById(id)?.shadowRoot;if(root)localize(root);}
    });
    const floatingPanel = initFloatingPanel();
    const translationPopup = createTranslationPopup(send);
    document.addEventListener('pd-panel-layout', () => renderBar());
    let currentVideoId = videoIdFromLocation();
    let nonce = 0;
    let navSeq = 0;
    let cues: LearningCue[] = [];
    let blocks: SourceFragment[] = [];
    let blockRanges: { from: number; to: number }[] = [];
    let blockCueIndices: number[][] = [];
    let currentBlock = -1;
    let layout: ReturnType<typeof buildSubtitleUnits> = {unitsByBlock: [], partsByCue: []};
    let currentUnit = -1;
    const shownBeforeSegmentation = new Map<number, readonly DisplayUnit[]>();
    let sourceRevision = '';
    let revision = '';
    let generation = crypto.randomUUID();
    let pinnedIndex = -1;
    let rowSeekTime: number | null = null;
    let lastTrack = '';
    let lastTrackLang = '';
    let lastTrackId = '';
    let tracklist: TrackInfo[] = [];
    let pendingTrack: TrackInfo | null = null;
    let notice = '';
    let nocuesReason = '';
    let nocuesRetries = 0;
    let acquisitionTimer: ReturnType<typeof setTimeout> | null = null;
    let ccDiag = 'init';
    let ccClicks = 0;
    let nativeCaptionsWereOn: boolean | null = null;
    let sawTimedtext = -1;
    // 徽标默认隐藏（保留诊断入口：页面事件 blc-debug-toggle 切换）
    let badgeVisible = false;

    // 双语 / 中文显隐（会话内状态）
    let bilingualOn = false;
    const readers = new Map<ReturnType<typeof browser.tabs.connect>, SubtitleReaderDemand>();
    let readerWantsSource = false;
    let readerWantsTranslation = false;
    let readerGeneration = '';
    let readerRows: number[] = [];
    let acquiringForView = false;
    const boundaryHost = createSubtitleBoundaryHost();
    let translatingForView = false;

    function refreshReaderDemand() {
      const live = [...readers.values()].filter(r => r.videoId === currentVideoId);
      readerWantsSource = live.length > 0;
      readerWantsTranslation = live.some(r => r.view === 'subs');
      readerGeneration = generation;
      readerRows = [...new Set(live.flatMap(r => r.view === 'subs' && r.generation === generation ? r.visible : []))];
      syncSubtitleDemand();
    }
    function visibleSubtitleIndices() { return readerGeneration === generation ? readerRows : []; }
    function showTranslation() { return zhVisible && baseLang(lastTrackLang) !== baseLang(targetLangOf()); }
    function translationDemand() { return showTranslation() && (bilingualOn || readerWantsTranslation); }

    function syncSubtitleDemand() {
      if (!settingsReady || !currentVideoId) return;
      const source = bilingualOn || readerWantsSource;
      if (source !== acquiringForView) {
        acquiringForView = source;
        if (source) {
          notice = ''; nocuesRetries = 0; nocuesReason = '';
          sendConfig(pendingTrack ?? undefined);
        } else {
          cancelSourceAcquisition();
        }
        if (source && (bilingualOn || !blocks.length || pendingTrack)) ensureCaptionsOn(20);
        if (!source) restoreNativeCaptions();
      }
      const translate = translationDemand();
      if (!translate && translatingForView) stopTranslation();
      translatingForView = translate;
      if (translate) scheduleTranslate();
    }

    browser.runtime.onConnect.addListener(port => {
      if (port.name !== SUBTITLE_READER_PORT || port.sender?.id !== browser.runtime.id) return;
      port.onMessage.addListener((d: SubtitleReaderDemand) => {
        if (d.videoId !== currentVideoId || currentVideoId !== videoIdFromLocation()) return;
        readers.set(port, d);
        refreshReaderDemand();
      });
      port.onDisconnect.addListener(() => { if (readers.delete(port)) refreshReaderDemand(); });
    });
    let zhVisible = true;

    // 翻译会话（videoId|trackId 域内复用）
    const records = { A: new Map<number, SubtitleTranslationRecord>(), B: new Map<number, SubtitleTranslationRecord>() };
    let variant: 'A' | 'B' = 'A';
    let platformBlocks: Cue[] = [];
    function recordAt(index: number) {
      return records[variant].get(index) ?? records.A.get(index);
    }
    function sentenceTranslation(index: number) {
      const record = recordAt(index);
      return record?.full ?? (record && joinSubtitleLines(record.lines, targetLangOf()));
    }
    function sourceLabel(source: string) {
      if (source === 'youtube') return 'YouTube · ' + tr('平台翻译');
      if (source === 'ai') return tr('AI 翻译');
      return source === 'browser-native' ? tr('浏览器内置翻译') : tr('Google 常规翻译');
    }
    function sentenceSource(index: number) {
      const record = recordAt(index);
      if (!record) return undefined;
      const lines = [...new Set(record.lineSources.map(sourceLabel))].join(' / ');
      return record.fullSource && translationMode === 'regular'
        ? tr('逐块字幕 + 整句译文（降级）') + ' · ' + lines + ' / ' + sourceLabel(record.fullSource)
        : lines;
    }
    let translating = false;
    let settings: Settings = { ...DEFAULT_SETTINGS };
    let settingsReady = false;
    let settingsFailed = false;
    let translationMode: 'regular' | 'ai' = 'regular';
    let modeReady = false;
    let modeBusy = false;
    let autoPause = false;
    let apIndex = -1;
    let apHeld = false;
    let apLastStopped = -1;
    let translationEpoch = 0;
    let fallbackEpoch = 0;
    let fallbackRetryAt = 0;
    let requestId: string | null = null;
    let platformRequest: { id: string; cacheKey: string; targetLang: string } | null = null;
    let platformState: 'idle' | 'waiting' | 'done' = 'idle';
    let platformTimer: ReturnType<typeof setTimeout> | null = null;
    const failedCues = new Set<number>();
    const pendingCues = new Set<number>();
    let queuedBlock = -1;

    // 当前句
    let currentIdx = -1;
    let renderQueued = false;

    // 词状态（字幕内低强调标记）
    let markBuckets = new Map<string, MarkBucket>();
    // 查词暂停恢复
    let pausedByUsVideo: string | null = null;
    let externalLookupToken='';
    let activeWord: HTMLElement | null = null;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    let suppressWord: HTMLElement | null = null;


    type LogEvent = { t: number; type: string } & Record<string, unknown>;
    const events: LogEvent[] = [];

    function log(type: string, data: Record<string, unknown> = {}): void {
      const entry: LogEvent = Object.assign({ t: Date.now(), type }, data);
      events.push(entry);
      if (events.length > 40) events.shift();
      console.info('[blc]', type, JSON.stringify(data));
      renderBadge();
    }

    function send<T>(msg: unknown): Promise<T> {
      return sendRuntime<T>({ ...(msg as object), fullscreen: !!document.fullscreenElement });
    }

    // ---- 徽标（默认隐藏，data-blc-* 属性始终更新） -----------------------------

    function ensureBadge(): HTMLElement {
      let host = document.getElementById(BADGE_ID);
      if (!host) {
        host = document.createElement('div');
        host.id = BADGE_ID;
        document.documentElement.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
          .box {
            position: fixed; top: 8px; right: 8px; z-index: 2147483647;
            max-width: 480px; padding: 6px 10px;
            background: rgba(0, 0, 0, 0.82); color: #fff;
            font: 11px/1.5 Consolas, Menlo, monospace; white-space: pre-wrap;
            border-radius: 4px; pointer-events: none;
          }
          .box[hidden] { display: none; }
        `;
        root.appendChild(style);
        const box = document.createElement('div');
        box.className = 'box';
        if (!badgeVisible) box.setAttribute('hidden', '');
        root.appendChild(box);
      }
      return host;
    }

    function renderBadge(): void {
      const host = ensureBadge();
      const box = host.shadowRoot!.querySelector('.box') as HTMLElement;
      const hasEn = lastTrackLang === 'en';
      const state = cues.length
        ? hasEn
          ? 'cues'
          : 'noenglish'
        : notice
          ? 'notice'
          : nocuesReason
            ? 'nocues'
            : currentVideoId
              ? 'waiting'
              : 'idle';
      const lines = [`BLC ${state} · video=${currentVideoId || '(none)'}`];
      if (cues.length) {
        lines.push(`track=${lastTrackLang || '?'}(${lastTrack}) · cues=${cues.length}`);
        lines.push(`first ${formatCue(cues[0]!)}`);
        lines.push(`last  ${formatCue(cues[cues.length - 1]!)}`);
        if (currentIdx >= 0 && cues[currentIdx]) {
          lines.push(`now   ${formatCue(cues[currentIdx]!)}`);
        }
        lines.push(`zh=${records[variant].size}/${cues.length} idx=${currentIdx}`);
      } else if (notice) {
        lines.push(`notice: ${notice}`);
      } else if (nocuesReason) {
        lines.push(`nocues: ${nocuesReason}`);
      }
      lines.push(`cc=${ccDiag} clicks=${ccClicks} seen=${sawTimedtext}`);
      box.textContent = lines.join('\n');
      if (badgeVisible) box.removeAttribute('hidden');
      else box.setAttribute('hidden', '');

      // 宿主元素上的属性供自动化断言（Shadow DOM 内文本对页面脚本不可直达）。
      host.setAttribute('data-blc-state', state);
      host.setAttribute('data-blc-video', currentVideoId);
      host.setAttribute('data-blc-track', lastTrack);
      host.setAttribute('data-blc-track-lang', lastTrackLang);
      host.setAttribute('data-blc-track-id', lastTrackId);
      host.setAttribute('data-blc-count', cues.length ? String(cues.length) : '');
      host.setAttribute('data-blc-nav-seq', String(navSeq));
      host.setAttribute('data-blc-cc', ccDiag);
      host.setAttribute('data-blc-seen', String(sawTimedtext));
      host.setAttribute('data-blc-idx', String(currentIdx));
      host.setAttribute('data-blc-zh', String(records[variant].size));
      host.setAttribute('data-blc-bilingual', bilingualOn ? 'on' : 'off');
      host.setAttribute('data-blc-chinese', zhVisible ? 'shown' : 'hidden');
      host.setAttribute('data-blc-notice', notice);
      host.setAttribute('data-blc-log', JSON.stringify(events));
    }

    window.addEventListener('blc-debug-toggle', () => {
      badgeVisible = !badgeVisible;
      renderBadge();
    });

    // ---- 播放器 / 视频 ---------------------------------------------------------

    function getVideo(): HTMLVideoElement | null {
      return (
        document.querySelector('#movie_player video') ??
        document.querySelector('video')
      );
    }

    let observedPlayer: Element | null = null;
    let observedWatchPage: Element | null = null;
    const playerResize = new ResizeObserver(() => {
      // YouTube 给视频和控制条写入像素尺寸；只改容器宽度不会更新这些值。
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    const watchMode = new MutationObserver(queueRender);

    function observePlayerLayout(): void {
      const player = document.getElementById('movie_player');
      if (player !== observedPlayer) {
        playerResize.disconnect();
        observedPlayer = player;
        if (player) playerResize.observe(player);
      }
      const watchPage = document.querySelector('ytd-watch-flexy');
      if (watchPage !== observedWatchPage) {
        watchMode.disconnect();
        observedWatchPage = watchPage;
        if (watchPage) watchMode.observe(watchPage, { attributes: true, attributeFilter: ['theater'] });
      }
    }

    let playListenerBound = false;
    function bindPlayListener(): void {
      if (playListenerBound) return;
      playListenerBound = true;
      document.addEventListener('seeking', e => {
        const video = getVideo();
        if (!video || e.target !== video) return;
        if (rowSeekTime !== video.currentTime) { pinnedIndex = -1; rowSeekTime = null; }
        pausedByUsVideo = null; apHeld = false; apIndex = -1; apLastStopped = -1;
        tick(true);
      }, true);
      document.addEventListener('seeked', e => {
        if (e.target === getVideo()) { rowSeekTime = null; tick(true); }
      }, true);
      document.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key.toLowerCase() === 'k') pausedByUsVideo = null;
      }, true);
      playerRoot().addEventListener('pointerdown', e => {
        if (e.composedPath().some(n => n instanceof Element && (n.matches('video,.ytp-play-button') || n.matches('.html5-video-container')))) pausedByUsVideo = null;
      }, true);
      // YouTube SPA 内复用同一个 <video>；用户主动恢复播放后不再代为恢复
      document.addEventListener(
        'play',
        (e) => {
          const t = e.target;
          if (t instanceof HTMLVideoElement) { pausedByUsVideo = null; apHeld = false; }
        },
        true,
      );
    }

    // ---- 与 MAIN world 嗅探脚本的桥 ---------------------------------------------

    function postToInject(msg: Record<string, unknown>): void {
      try {
        window.postMessage(Object.assign({ source: CONTENT_SOURCE }, msg), '*');
      } catch {
        /* ignore */
      }
    }

    function sendConfig(target?: TrackInfo): void {
      if (!currentVideoId) return; // 非视频页不请求
      boundaryHost.cancel();
      nonce++;
      armAcquisitionTimer();
      postToInject(target ? { type: 'select-track', nonce, videoId: currentVideoId, trackId: target.id } : { type: 'config', nonce });
    }

    function armAcquisitionTimer(): void {
      // 覆盖整个首屏获取，包括 MAIN 未响应；自动恢复不能延长这份预算。
      if ((!blocks.length || pendingTrack) && !acquisitionTimer) {
        acquisitionTimer = setTimeout(() => {
          acquisitionTimer = null;
          if (blocks.length && !pendingTrack) return;
          failAcquisition(nocuesReason && nocuesReason !== 'no-timedtext-seen' ? nocuesReason : 'acquisition-timeout');
        }, 30000);
      }
    }

    function clearAcquisitionTimer(): void {
      if (acquisitionTimer) clearTimeout(acquisitionTimer);
      acquisitionTimer = null;
    }

    function cancelSourceAcquisition(): void {
      boundaryHost.cancel();
      clearAcquisitionTimer();
      postToInject({ type: 'source-cancel', nonce });
      nonce++;
    }

    function failAcquisition(reason: string): void {
      boundaryHost.cancel();
      clearAcquisitionTimer();
      postToInject({ type: 'source-cancel', nonce });
      nonce++; // 已排入消息队列的旧代次回复也不能恢复本轮。
      nocuesReason = reason;
      notice = reason.includes('timeout') ? '字幕获取超时'
        : reason === 'empty-response' || reason === 'empty-track' ? '字幕响应为空，请重试'
        : reason === 'fetch-failed' ? '字幕网络请求失败，请重试'
        : reason === 'parse-failed' ? '字幕解析失败，请重试'
        : pendingTrack ? '字幕切换失败，请重新选择原文语言' : '字幕获取失败';
      pendingTrack = null;
      if (!bilingualOn) restoreNativeCaptions();
      log('subtitle-error', { reason });
      renderBar();
    }

    function sendNudge(): void {
      postToInject({ type: 'nudge' });
    }

    function baseLang(s: string): string {
      return (s || '').split('-')[0]!.toLowerCase();
    }

    // ---- 打开 YouTube 原生 CC（嗅探需要播放器发出 timedtext 请求） --------------

    function isShortsPage(): boolean {
      return location.pathname.startsWith('/shorts/');
    }

    function ensureCaptionsOn(retries: number, videoId = currentVideoId): void {
      if (videoId !== currentVideoId || !acquiringForView || (!bilingualOn && blocks.length && !pendingTrack) || isShortsPage()) return;
      const player = document.getElementById('movie_player');
      const cc = player?.querySelector('.ytp-subtitles-button');
      if (!cc || cc.getAttribute('aria-pressed') === null) {
        if (retries > 0) setTimeout(() => ensureCaptionsOn(retries - 1, videoId), 600);
        return;
      }
      if (cc.getAttribute('aria-disabled') === 'true') {
        if (retries > 0) setTimeout(() => ensureCaptionsOn(retries - 1, videoId), 600);
        return;
      }
      if (nativeCaptionsWereOn === null) nativeCaptionsWereOn = cc.getAttribute('aria-pressed') === 'true';
      if (cc.getAttribute('aria-pressed') !== 'true') {
        // A sidebar-only capture may briefly need CC to obtain the timed-text URL.
        if (!bilingualOn) hideNativeCaptions();
        (cc as HTMLElement).click();
        ccClicks++;
        log('cc-on', { videoId: currentVideoId, by: 'extension', clicks: ccClicks });
      }
    }

    function readCcDiag(): void {
      const player = document.getElementById('movie_player');
      const cc = player?.querySelector('.ytp-subtitles-button');
      if (!player) ccDiag = 'noplayer';
      else if (!cc) ccDiag = 'absent';
      else if (cc.getAttribute('aria-pressed') === null) ccDiag = 'noattr';
      else if (cc.getAttribute('aria-disabled') === 'true') ccDiag = 'disabled';
      else if (cc.getAttribute('aria-pressed') === 'true') ccDiag = 'on';
      else ccDiag = 'off';
      renderBadge();
    }

    /** 关闭双语：恢复播放器原字幕显示（去掉我方隐藏样式）。 */
    function restoreNativeCaptions(): void {
      document.getElementById(NATIVE_CAPTIONS_HIDE_STYLE_ID)?.remove();
      const cc = playerRoot().querySelector<HTMLElement>('.ytp-subtitles-button');
      if (nativeCaptionsWereOn === false && cc?.getAttribute('aria-pressed') === 'true') cc.click();
      nativeCaptionsWereOn = null;
    }

    function hideNativeCaptions(): void {
      if (!blocks.length && (bilingualOn || nativeCaptionsWereOn !== false)) {
        document.getElementById(NATIVE_CAPTIONS_HIDE_STYLE_ID)?.remove();
        return;
      }
      if (document.getElementById(NATIVE_CAPTIONS_HIDE_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = NATIVE_CAPTIONS_HIDE_STYLE_ID;
      style.textContent =
        '#movie_player .ytp-caption-window-container { display: none !important; }';
      document.head?.appendChild(style);
    }

    // ---- 字幕栏（Shadow DOM，普通模式在画面下方；全屏在播放器内） -----------------------------

    function playerRoot(): HTMLElement {
      return document.getElementById('movie_player') ?? document.documentElement;
    }

    let bilingualBusy = false;
    let bilingualError = false;

    function videoSettingsState(): VideoSettingsState {
      const tracks = [...tracklist];
      const current = trackOfUrl(lastTrackId) ?? captionTrackOf({ languageCode: lastTrackLang, kind: lastTrack === 'asr' ? 'asr' : '' });
      if (current && !tracks.some(t => t.id === current.id)) tracks.push(current);
      return { videoId: currentVideoId, generation, title: document.title, tracks,
        trackId: pendingTrack?.id ?? current?.id ?? '', switchingTrack: acquiringForView && !!pendingTrack,
        mode: translationMode, autoPause, ready: modeReady && !modeBusy,
        hasCues: !!blocks.length, notice };
    }

    function ensureSwitchHost(): void {
      if (!currentVideoId) { document.getElementById(SWITCH_ID)?.remove(); return; }
      const parent = playerRoot().querySelector('.ytp-right-controls') ?? playerRoot();
      let host = document.getElementById(SWITCH_ID);
      if (!host) {
        host = document.createElement('div'); host.id = SWITCH_ID;
        applyAppearance(host);
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>
          :host {display:inline-flex;vertical-align:top;height:100%;align-items:center;text-shadow:none}
          ${brandTokens}
          button {display:inline-flex;align-items:center;justify-content:center;width:48px;min-height:34px;height:100%;padding:0;border:0;border-radius:0;background:transparent;color:white;cursor:pointer;text-shadow:none}
          button:focus-visible {outline:2px solid #8ab4f8;outline-offset:-2px}
          .caption-icon {width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 1px #000c)}
          #learning[aria-pressed=true] .caption-frame {fill:currentColor}
          #learning[aria-pressed=true] .caption-glyph {stroke:#151719}
          button:disabled {opacity:.5} #learning[data-error=true] {color:#ffb4ab}
          #learning[data-error=true] .caption-frame {fill:none}
          #learning[data-error=true] .caption-glyph {stroke:currentColor}
        </style><button id="learning" type="button"><svg class="caption-icon" viewBox="0 0 24 24" aria-hidden="true"><rect class="caption-frame" x="2" y="4" width="20" height="16" rx="1"/><path class="caption-glyph" d="M5 9h8M9 7v2m3 0c-1 3-3 5-6 6m.5-4.5c.8 1.7 2.1 3 4 4M13 17l3-7 3 7m-5-2h4"/></svg></button>`;
        root.querySelector('#learning')!.addEventListener('click', () => void setBilingual(!bilingualOn));
        host.addEventListener('click', e => e.stopPropagation());
        host.addEventListener('keydown', e => e.stopPropagation());
      }
      if (host.parentElement !== parent) parent.append(host);
      host.style.cssText = parent === playerRoot() ? 'position:absolute;right:100px;bottom:10px;z-index:66;height:32px;' : '';
      const root = host.shadowRoot!;
      const toggle = root.querySelector<HTMLButtonElement>('#learning')!;
      toggle.disabled = bilingualBusy || !settingsReady;
      toggle.setAttribute('aria-pressed', String(bilingualOn));
      toggle.dataset.error = String(bilingualError);
      const label = message(bilingualError ? '字幕开关保存失败，请重试' : bilingualOn ? '关闭双语字幕' : '打开双语字幕');
      setLocalizedAttribute(toggle, 'title', label); setLocalizedAttribute(toggle, 'aria-label', label);
    }

    function ensureSubsHost(): { host: HTMLElement; body: HTMLDivElement } | null {
      if (!document.getElementById('movie_player')) return null;
      let host = document.getElementById(SUBS_ID);
      if (!host) {
        host = document.createElement('div'); host.id = SUBS_ID;
        applyAppearance(host);
        const root = host.attachShadow({ mode:'open' });
        root.innerHTML = `<style>
          ${brandTokens}:host { display:block; color:#fff; font:var(--blc-font,28px)/1.45 system-ui,"Microsoft YaHei",sans-serif; }
          .wrap { text-align:center; padding:12px 18px; background:#151719; border-radius:0 0 8px 8px; }
          .bar { max-inline-size:56ch; margin-inline:auto; overflow-wrap:anywhere; }
          .en { font-weight:600; overflow-wrap:anywhere; } .zh { font-size:.8em; color:#e1cc91; margin-top:6px; }
          .zh { position:relative; box-sizing:border-box; }
          .zh-text { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; cursor:pointer; user-select:text; }
          .zh[aria-expanded=true] .zh-text { position:absolute; inset-inline:0; inset-block-start:0; z-index:2; display:block; overflow:visible; border-radius:4px; background:#151719; }
          .zh[data-up] .zh-text { inset-block-start:auto; inset-block-end:0; }
          .zh:focus-visible { outline:2px solid #8ab4f8; border-radius:4px; }
          .w[data-pause]::before { content:'… '; opacity:.7; }
          .notice { color:#b7bdc7; font-size:14px; } .w { cursor:pointer; border-radius:3px; } .w:hover { background:#454d58; }
          .w:focus-visible { outline:2px solid #8ab4f8; } .saved,.known { border-bottom:2px solid color-mix(in srgb,var(--pd-blue),white 62%); }
          button { cursor:pointer; margin:6px; padding:4px 10px; border:1px solid #555; border-radius:5px; background:#292b30; color:#eee; font:14px system-ui; }
          :host([data-fullscreen]) .wrap { background:transparent; padding:4px 8px; text-shadow:0 1px 3px #000,0 0 2px #000; }
          :host([data-fullscreen]) .en,:host([data-fullscreen]) .zh { width:fit-content;max-width:100%;margin-left:auto;margin-right:auto;background:rgba(16,18,20,.72);padding:2px 8px;border-radius:4px; }
        </style><div class="wrap"></div>`;
        bindWordEvents(root.querySelector<HTMLElement>('.wrap')!);
      }
      const fs = document.fullscreenElement;
      host.toggleAttribute('data-fullscreen', !!fs);
      if (fs) {
        if (host.parentElement !== fs) fs.append(host);
        host.style.cssText = SUBS_FULLSCREEN_CSS;
      } else {
        host.style.position = 'relative'; host.style.left = ''; host.style.right = ''; host.style.bottom = ''; host.style.zIndex = '';
        const target = document.querySelector<HTMLElement>('ytd-watch-flexy[theater] #full-bleed-container') ?? document.getElementById('player-container-outer') ?? playerRoot();
        if (target.nextElementSibling !== host) target.after(host);
        // 独立字幕行占播放器一列，侧栏跨两行。
        if (target.parentElement?.id === 'blc-learning-layout') { host.style.gridColumn = '1'; host.style.gridRow = '2'; } else { host.style.gridColumn = ''; host.style.gridRow = ''; }
      }
      host.style.setProperty('--blc-font', `${subtitleFontSize(settings.subtitleSize)}px`);
      return { host, body:host.shadowRoot!.querySelector<HTMLDivElement>('.wrap')! };
    }

    function bindWordEvents(wrap: HTMLElement): void {
      const root = wrap.getRootNode() as ShadowRoot;
      let pointerX = 0, pointerY = 0;
      const rememberPosition = (e: PointerEvent) => { pointerX = e.clientX; pointerY = e.clientY; };
      wrap.addEventListener('pointermove', rememberPosition);
      const wordOf = (e: Event) => (e.target as Element).closest<HTMLElement>('[data-cue] .w');
      const indexOf = (word: HTMLElement) => Number(word.closest<HTMLElement>('[data-cue]')!.dataset.cue);
      wrap.addEventListener('pointerover', e => {
        rememberPosition(e);
        const word = wordOf(e);
        if (e.buttons || e.pointerType === 'touch' || !word || word === suppressWord || (popup.isOpen() && !popup.isCompact())) return;
        clearTimeout(leaveTimer); clearTimeout(hoverTimer);
        if (word === activeWord && popup.isOpen()) return;
        hoverTimer = setTimeout(() => {
          if (word.isConnected && word.contains(root.elementFromPoint(pointerX, pointerY)) && !shadowSelection(root)) {
            openLookup(word.textContent!, indexOf(word), word, true);
          }
        }, 180);
      });
      wrap.addEventListener('pointerout', e => {
        const word = wordOf(e);
        if (!word || word.contains(e.relatedTarget as Node)) return;
        if (suppressWord === word) suppressWord = null;
        clearTimeout(hoverTimer);
        scheduleCardClose();
      });
      wrap.addEventListener('pointerdown', () => clearTimeout(hoverTimer));
      wrap.addEventListener('pointercancel', () => clearTimeout(hoverTimer));
      wrap.addEventListener('mouseup', e => {
        if (!(e.target as Element).closest('.en')) return;
        const info = subtitleSelectionInBar();
        if (info) showSelectionActions(info);
      });
      const activateWord = (e: Event) => {
        const word = wordOf(e);
        if (!word || shadowSelection(root)) return;
        e.preventDefault(); e.stopPropagation();
        clearTimeout(hoverTimer); clearTimeout(leaveTimer);
        if (activeWord === word && popup.isOpen()) {
          if (popup.isCompact()) popup.expand();
          else { suppressWord = word; popup.close(); }
        } else openLookup(word.textContent!, indexOf(word), word);
      };
      wrap.addEventListener('click', activateWord);
      wrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activateWord(e); });
    }

    // Keep the full accessible text in one node. Only the visual clamping and
    // position change, so expansion does not resize the subtitle row.
    let collapsePlayerTranslation: (() => void) | undefined;
    function createPlayerTranslation() {
      const slot = document.createElement('div');
      slot.className = 'zh';
      slot.tabIndex = 0;
      slot.setAttribute('role', 'button');
      slot.setAttribute('aria-expanded', 'false');
      const text = document.createElement('span');
      text.className = 'zh-text';
      slot.append(text);
      let pinned = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const collapse = () => {
        pinned = false;
        clearTimeout(timer);
        slot.setAttribute('aria-expanded', 'false');
        slot.style.blockSize = '';
        slot.style.inlineSize = '';
        delete slot.dataset.up;
        document.removeEventListener('keydown', escape, true);
        if (collapsePlayerTranslation === collapse) collapsePlayerTranslation = undefined;
      };
      const escape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        collapse();
      };
      function expand() {
        if (slot.getAttribute('aria-expanded') === 'true') return;
        const rect = slot.getBoundingClientRect();
        slot.style.blockSize = rect.height + 'px';
        slot.style.inlineSize = rect.width + 'px';
        slot.toggleAttribute('data-up', rect.top + text.scrollHeight > innerHeight);
        slot.setAttribute('aria-expanded', 'true');
        document.addEventListener('keydown', escape, true);
        collapsePlayerTranslation = collapse;
      }
      const selected = () => shadowSelection(slot.getRootNode() as ShadowRoot);
      slot.addEventListener('pointerenter', e => {
        if (e.buttons || e.pointerType === 'touch') return;
        timer = setTimeout(() => {
          if (slot.isConnected && !selected()) expand();
        }, 180);
      });
      slot.addEventListener('pointerdown', () => clearTimeout(timer));
      slot.addEventListener('pointerleave', () => { clearTimeout(timer); if (!pinned) collapse(); });
      const pin = (e: Event) => {
        if (selected()) return;
        e.preventDefault(); e.stopPropagation(); clearTimeout(timer);
        expand();
        pinned = true;
      };
      slot.addEventListener('click', pin);
      slot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pin(e); });
      return slot;
    }

    interface SubtitleSelectionInfo {
      raw: string;
      kind: 'word' | 'phrase' | 'sentence' | 'cross-cue';
      hasWord: boolean;
      expression: string | null;
      cueIndex: number;
      lastIndex: number;
      rect: DOMRect | null;
      range: Range;
    }

    /** 播放器字幕栏选区：收窄到原文行（不含译文/控件文字），本地分类 + 有效表达。 */
    function subtitleSelectionInBar(): SubtitleSelectionInfo | null {
      const root = document.getElementById(SUBS_ID)?.shadowRoot;
      if (!root) return null;
      const selected = shadowSelection(root);
      if (!selected || !currentVideoId || !lastTrackId) return null;
      const en = root.querySelector<HTMLElement>('.en');
      if (!en || !selected.range.intersectsNode(en)) return null;
      const range = clampRangeToElement(selected.range, en);
      const owners = [...en.querySelectorAll<HTMLElement>('[data-cue]')].filter(part =>
        range.intersectsNode(part) && clampRangeToElement(range, part).toString().trim());
      const first = owners[0], last = owners.at(-1);
      if (!first || !last) return null;
      const raw = range.toString().trim();
      const bounds = {cueIndex:Number(first.dataset.cue), lastIndex:Number(last.dataset.cue),
        rect:range.getBoundingClientRect(), range};
      if (first !== last) return { ...bounds, raw, kind:'cross-cue', expression:null, hasWord:false };
      const cls = classifyRangeIn(en, range, baseLang(lastTrackLang) || 'en');
      return cls && { ...bounds, raw, kind:cls.kind, hasWord:cls.hasWord, expression:cls.expression };
    }

    function subtitleCandidate(info: SubtitleSelectionInfo): SelectionCandidate | null {
      const source = buildVideoSource();
      const cue = cues[info.cueIndex];
      if (!source?.video || !cue) return null;
      if (info.kind === 'cross-cue') {
        const last = cues[info.lastIndex]!;
        return {at:Date.now(), pageUrl:location.href, text:info.raw, kind:info.kind, expression:null, source,
          crossFromMs:cue.start, crossToMs:last.start+last.dur, crossCount:info.lastIndex-info.cueIndex+1};
      }
      return {
        at: Date.now(),
        pageUrl: location.href,
        text: info.raw,
        kind: info.kind,
        expression: info.kind === 'sentence' ? null : info.expression,
        lang: lastTrackLang || undefined,
        source,
        cue: { index: info.cueIndex, text: cue.text, startMs: cue.start, endMs: cue.start + cue.dur },
      };
    }

    /** 直接附加到当前聊天并打开面板；不先查词、不自动发送。 */
    async function attachSubtitleSelection(info: SubtitleSelectionInfo): Promise<void> {
      const source = buildVideoSource();
      const candidate = subtitleCandidate(info);
      const built = candidate ? materialFromCandidate(candidate) : null;
      if (!source || !candidate || !built) { playerToast(message('字幕尚未就绪，稍后再试')); return; }
      const r = await send<{ ok: boolean; panelOpened?: boolean }>({
        type: 'chatEnsure', source, material: built.material, quote: built.quote, openPanel: true,
      });
      if (!r?.ok) { playerToast(message('附加失败，请重试')); return; }
      if (!r.panelOpened) playerToast(message('已附加到当前对话：点扩展图标打开侧栏继续'));
    }

    let closeSelectionActions: (() => void) | null = null;
    let dismissedSelection: SubtitleSelectionInfo | null = null;
    const sameSubtitleSelection = (a: SubtitleSelectionInfo | null, b: SubtitleSelectionInfo | null): boolean =>
      !!a && !!b && a.raw === b.raw && a.cueIndex === b.cueIndex &&
      a.range.startContainer === b.range.startContainer && a.range.startOffset === b.range.startOffset &&
      a.range.endContainer === b.range.endContainer && a.range.endOffset === b.range.endOffset;

    function showSelectionActions(info: SubtitleSelectionInfo) {
      if (sameSubtitleSelection(dismissedSelection, info)) return;
      closeSelectionActions?.();
      dismissedSelection = null;
      const host=document.createElement('div');host.id='pd-phrase-actions';
      host.style.cssText='position:fixed;z-index:2147483646';
      applyAppearance(host);
      const root=host.attachShadow({mode:'open'});
      root.innerHTML=`<style>${brandTokens}:host{display:block;text-shadow:none;letter-spacing:normal;text-transform:none;font-weight:400}${selectionActionStyles}</style><div class="selection-actions"><button id="lookup" type="button" hidden data-i18n-title="查词" data-i18n-aria-label="查词">${uiIcon('lookup')}</button><button id="translate" type="button" hidden data-i18n-title="翻译" data-i18n-aria-label="翻译">${uiIcon('translate')}</button><button id="chat" type="button" class="blc-chat-add" data-i18n-title="添加到对话" data-i18n-aria-label="添加到对话">${CHAT_ADD_ICON}</button></div>`;
      localize(root);
      (document.fullscreenElement??document.documentElement).append(host);
      // 分类表：word=查词+对话；phrase=查词+翻译+对话；sentence=翻译+对话
      root.querySelector<HTMLElement>('#lookup')!.hidden = info.kind === 'sentence' || !info.hasWord;
      root.querySelector<HTMLElement>('#translate')!.hidden = info.kind === 'word';
      const box=host.getBoundingClientRect(),below=(info.rect?.bottom??64)+6;
      host.style.left=Math.max(8,Math.min(info.rect?.left??24,innerWidth-box.width-8))+'px';
      host.style.top=Math.max(8,below+box.height<=innerHeight-8?below:(info.rect?.top??innerHeight)-box.height-6)+'px';
      const rect = info.rect ?? undefined;
      root.querySelector('#lookup')!.addEventListener('click',()=>{closeSelectionActions?.();openLookup(info.expression ?? info.raw, info.cueIndex);});
      const selectedCue = cues[info.cueIndex];
      const translationSnapshot = {text:info.raw,url:videoContextUrl(currentVideoId,selectedCue?.start??0),title:document.title,source:buildVideoSource()??undefined,sourceLang:lastTrackLang||undefined,languageEvidence:'track' as const,
        position:{videoId:currentVideoId,trackId:lastTrackId,trackKind:lastTrack==='asr'?'asr' as const:'manual' as const,trackLang:lastTrackLang||'und',startMs:selectedCue?.start??0,endMs:(selectedCue?.start??0)+(selectedCue?.dur??0)}};
      root.querySelector('#translate')!.addEventListener('click',()=>{closeSelectionActions?.();popup.close();translationPopup.open(translationSnapshot,rect);});
      root.querySelector('#chat')!.addEventListener('click',()=>{closeSelectionActions?.();popup.close();void attachSubtitleSelection(info);});
      host.addEventListener('mousedown',e=>e.preventDefault());
      // 选区形成即固定候选（面板进入/字幕重绘不清空）
      const candidate = subtitleCandidate(info);
      if (candidate) void send({ type: 'selectionCandidateSet', candidate });
      const outside = (e: Event) => { if (!e.composedPath().includes(host)) closeSelectionActions?.(); };
      const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSelectionActions?.(); };
      const checkSelection = () => {
        if (!info.range.startContainer.isConnected || !info.range.endContainer.isConnected ||
          !sameSubtitleSelection(info, subtitleSelectionInBar())) closeSelectionActions?.();
      };
      const observer = new MutationObserver(checkSelection);
      const subtitleRoot = document.getElementById(SUBS_ID)?.shadowRoot;
      if (subtitleRoot) observer.observe(subtitleRoot, { childList: true, subtree: true });
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', escape, true);
      document.addEventListener('selectionchange', checkSelection);
      closeSelectionActions = () => {
        dismissedSelection = info;
        host.remove(); observer.disconnect();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape, true);
        document.removeEventListener('selectionchange', checkSelection);
        closeSelectionActions = null;
      };
    }

    function scheduleCardClose(): void {
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => { if (popup.isCompact()) popup.close(); }, 220);
    }

    function removeSubsHost(): void {
      clearTimeout(hoverTimer);
      collapsePlayerTranslation?.();
      closeSelectionActions?.();
      document.getElementById(SUBS_ID)?.remove();
    }

    function queueRender(): void {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        renderBar();
      });
    }

    function retrySubtitleSource() {
      if (!acquiringForView || !notice) return;
      nocuesReason = ''; nocuesRetries = 0;
      sendConfig();
      if (!cues.length) {
        notice = '';
        ensureCaptionsOn(20);
        sendNudge();
      }
      renderBar();
    }

    function renderBar(): void {
      renderBadge();
      observePlayerLayout();
      ensureSwitchHost();
      if (!bilingualOn || !currentVideoId) {
        removeSubsHost();
        return;
      }
      const got = ensureSubsHost();
      if (!got) return;
      const { body } = got;
      const unit = layout.unitsByBlock[currentBlock]?.[currentUnit];
      const indices = [...new Set(unit?.parts.map(ref => ref.cue))];
      const key = generation + '/' + currentBlock + '/' + currentUnit;
      const bar = body.querySelector<HTMLDivElement>('.bar') ?? document.createElement('div');
      bar.className = 'bar';
      if (bar.dataset.screen !== key) {
        clearTimeout(hoverTimer);
        collapsePlayerTranslation?.();
        bar.replaceChildren();
        bar.dataset.screen = key;
      }
      for (const child of bar.querySelectorAll(':scope > .notice, :scope > button')) child.remove();
      if (bar.parentElement !== body) body.appendChild(bar);

      if (!blocks.length) {
        const n = document.createElement('div');
        n.className = 'notice';
        setText(n,message(notice || '正在获取字幕…'));
        bar.appendChild(n);
        if (notice) {
          const retry = document.createElement('button');
          setText(retry, message('重试字幕'));
          retry.addEventListener('click', retrySubtitleSource);
          bar.appendChild(retry);
        }
        return;
      }

      if (notice) {
        const n = document.createElement('div');
        n.className = 'notice';
        setText(n,message(notice));
        if (notice === SUBTITLE_FALLBACK_NOTICE) {
          const retry = document.createElement('button');
          setText(retry, message('重试字幕'));
          retry.onclick = retrySubtitleSource;
          n.append(retry);
        }
        bar.prepend(n);
      }

      const block = blocks[currentBlock];
      if (!block || !unit) return;
      if (!revision) shownBeforeSegmentation.set(currentBlock, layout.unitsByBlock[currentBlock]!);
      let row = bar.querySelector<HTMLElement>('[data-row]');
      if (!row) {
        row = document.createElement('div');
        row.dataset.row = String(currentBlock);
        const en = document.createElement('div');
        en.className = 'en';
        const lang = baseLang(lastTrackLang) || 'en';
        const start = unit.from;
        const pauses = blockPauseOffsets(block, lang).map(at => at + (blockRanges[currentBlock]?.from ?? 0) - start);
        let offset = 0;
        for (const i of indices) {
          const cue = cues[i]!;
          const left = Math.max(0, cue.from - start);
          const right = Math.min(unit.text.length, cue.to - start);
          en.append(unit.text.slice(offset,left));
          const part = document.createElement('span');
          part.dataset.cue = String(i);
          appendSubtitleText(part, unit.text.slice(left,right), lang,
            new Set(pauses.filter(at => at >= left && at < right).map(at => at - left)));
          en.append(part);
          offset = right;
        }
        en.append(unit.text.slice(offset));
        row.append(en);
        bar.append(row);
      }
      const en = row.firstElementChild!;
      row.querySelectorAll(':scope > .notice, :scope > button').forEach(element => element.remove());
      en.querySelectorAll<HTMLElement>('.w').forEach(w => {
        w.classList.remove('saved', 'learning', 'known');
        const status = wordStatus(w.textContent!); if (status) w.classList.add(status);
      });
      const eligible = indices.filter(i => !cues[i]!.segmentationFallback);
      let z = row.querySelector<HTMLElement>('.zh');
      const texts = showTranslation() ? unit.parts.map(ref => recordAt(ref.cue)?.lines[ref.part]).filter((v): v is string => !!v) : [];
      if (texts.length) {
        if (!z) { z = createPlayerTranslation(); row.append(z); }
        const full = joinSubtitleLines(texts, targetLangOf());
        if (z.firstChild!.textContent !== full) z.firstChild!.textContent = full;
      } else if (z) {
        collapsePlayerTranslation?.();
        z.remove();
      }
      if (showTranslation() && eligible.some(i => !records[variant].has(i))) {
        if (settingsFailed) {
          const error = document.createElement('div'); error.className = 'notice'; setText(error, message('无法连接扩展，请刷新页面')); row.appendChild(error);
          const reload = document.createElement('button'); setText(reload, message('刷新页面')); reload.addEventListener('click', () => location.reload()); row.appendChild(reload);
        } else if (eligible.some(i => failedCues.has(i) || fallbackRetryAt > Date.now() && pendingCues.has(i))) {
          const error = document.createElement('div'); error.className = 'notice'; setText(error, message('翻译暂不可用')); row.appendChild(error);
          const ai = document.createElement('button'); setText(ai, message('用 AI 翻译')); ai.addEventListener('click', () => void setTranslationMode('ai')); row.appendChild(ai);
          const retry = document.createElement('button'); setText(retry, message('重试')); retry.addEventListener('click', () => {
            fallbackRetryAt = 0;
            for (const i of eligible) {
              failedCues.delete(i);
              if (!records[variant].has(i)) pendingCues.add(i);
            }
            scheduleTranslate(); renderBar();
          }); row.appendChild(retry);
        } else {
          const pending = document.createElement('div'); pending.className = 'notice'; pending.setAttribute('role', 'status');
          setText(pending, !settingsReady ? message('正在读取翻译设置…') : platformState === 'waiting' ? message('正在获取{language}译文…',{language:langDisplayName(targetLangOf())}) : message('正在翻译…'));
          row.appendChild(pending);
        }
      }
    }

    function applyPlayerVisibility(on: boolean) {
      if (bilingualOn === on) return;
      bilingualOn = on;
      if (on) {
        hideNativeCaptions();
        if (acquiringForView) ensureCaptionsOn(20);
      } else {
        restoreNativeCaptions();
        removeSubsHost();
      }
    }

    async function setBilingual(on: boolean): Promise<void> {
      if (bilingualBusy) return;
      bilingualBusy = true; bilingualError = false; ensureSwitchHost();
      const result = await send<{ok:boolean}>({ type:'setSetting', name:'bilingualEnabled', value:on });
      bilingualBusy = false;
      if (!result?.ok) { bilingualError = true; ensureSwitchHost(); return; }
      applyPlayerVisibility(on);
      syncSubtitleDemand();
      log('bilingual', { on });
      renderBadge();
      renderBar();
    }

    // ---- 查词（共用弹窗 + 暂停 / 恢复） -------------------------------------------

    document.addEventListener('pointerdown', e => {
      if (e.composedPath().some(n => n instanceof Element && n.matches('[data-playback],video,.ytp-play-button,.ytp-progress-bar'))) pausedByUsVideo = null;
    }, true);
    const popup = createLookupPopup({ send, mountParent: () => document.fullscreenElement as HTMLElement | null });

    // ---- 页面正文选区浮条（描述 / 评论 / 标题等；字幕栏以内不介入） ---------------

    const selectionPill = createSelectionPill({
      send,
      lookup: popup,
      translation: translationPopup,
      buildSource: buildPageArticleSource,
      toast: playerToast,
      onContinueAsk: (ctx) => void continueAskFromPageBody(ctx),
      skipSelection: (sel) => {
        // 字幕栏 / 字幕选区操作条 / 词卡 / 翻译卡都在 Shadow DOM 内：
        // 选区根节点不是 document 就属于插件自身 UI，页面浮条不介入
        const node = sel.anchorNode;
        return !!node && node.getRootNode() !== document;
      },
    });

    function videoRef(index = currentIdx) {
      return { videoId:currentVideoId, trackId:lastTrackId, trackKind:lastTrack === 'asr' ? 'asr' as const : 'manual' as const,
        trackLang:lastTrackLang, startMs:cues[index]?.start ?? 0 };
    }
    async function writeSentence(index: number, vaultId: string | null, removeId: string | null): Promise<{ ok: boolean; error?: string }> {
      const cue = cues[index]; if (!cue) return { ok: false };
      const video = videoRef(index);
      const r = await send<{ ok:boolean }>(removeId !== null ? { type:'deleteSentence', id:removeId, vaultId } : {
        type:'saveSentence', vaultId, range: { from: cue.from, to: cue.to },
        sentence:{ video, text:cue.text, zh:sentenceTranslation(index), translationSource:sentenceSource(index),
          ...(lastTrackLang ? { language: lastTrackLang } : {}),
          endMs:cue.start + cue.dur, title:document.title },
      });
      return r?.ok ? { ok:true } : { ok:false, error:tr('收藏失败，请重试') };
    }
    function seekCue(index: number, play = false, navigate = false): void {
      const cue = cues[index]; if (!cue) return;
      const replayBlock = currentBlock >= 0 ? currentBlock : apHeld ? apLastStopped : -1;
      const shared = navigate && blockCueIndices[replayBlock]?.includes(index);
      if (shared && !play && index !== currentIdx) getVideo()?.pause();
      seekTo(shared ? blocks[replayBlock]!.start : cue.start, index, play);
    }

    function seekTo(timeMs: number, index: number, play: boolean): void {
      const v = getVideo();
      if (!v) return;
      const start = timeMs / 1000;
      pausedByUsVideo = null; apHeld = false; apIndex = -1; apLastStopped = -1;
      pinnedIndex = index;
      if (v.currentTime !== start) {
        v.currentTime = start;
        rowSeekTime = v.currentTime;
      }
      if (play) void v.play();
      tick(true);
    }

    // ---- M5 问答：视频来源与材料 ---------------------------------------------------

    function buildVideoSource(): SourceDescriptor | null {
      if (!currentVideoId) return null;
      const source: SourceDescriptor = {
        sourceType: 'youtube',
        sourceKey: sourceKeyOf({ sourceType: 'youtube', videoId: currentVideoId }),
        title: document.title,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(currentVideoId)}`,
      };
      if (lastTrackId) {
        source.video = {
          videoId: currentVideoId,
          trackId: lastTrackId,
          trackKind: lastTrack === 'asr' ? 'asr' : 'manual',
          trackLang: lastTrackLang,
        };
      }
      return source;
    }

    /** 页面正文选区（描述 / 评论 / 标题）来源：当前地址的 article 源（与视频源区分）。 */
    function buildPageArticleSource(): SourceDescriptor {
      return {
        sourceType: 'article',
        sourceKey: sourceKeyOf({ sourceType: 'article', url: location.href }),
        title: document.title,
        url: location.href,
      };
    }

    /** 材料仅在打开问答 / 更新材料 / 带入新引用时构建一次（不随播放重建）。 */
    function buildVideoMaterial(): MaterialPayload | null {
      if (!cues.length || !lastTrackId || !currentVideoId) return null;
      return {
        label: '当前轨道完整字幕',
        blocks: cues.map((c, i) => ({
          id: `p${i + 1}`,
          text: c.text,
          startMs: c.start,
          endMs: c.start + c.dur,
        })),
      };
    }

    function buildChatSourceInfo(): ChatSourceInfo {
      const source = buildVideoSource();
      if (!source) {
        return {
          type: 'blc-chat-source-info',
          source: null,
          canMaterial: false,
          hint: '当前不是视频页',
          pageUrl: location.href,
        };
      }
      return {
        type: 'blc-chat-source-info',
        source,
        canMaterial: !!lastTrackId && cues.length > 0,
        hint: cues.length ? '' : '字幕尚未就绪，稍后再试',
        pageUrl: location.href,
      };
    }

    // 播放器内轻提示（全屏时侧栏打不开等场景）
    function playerToast(text: string | UiText): void {
      const host = document.createElement('div');
      host.style.cssText =
        'position:absolute;left:50%;bottom:110px;transform:translateX(-50%);z-index:70;pointer-events:none;';
      const box = document.createElement('div');
      box.style.cssText =
        'background:rgba(8,8,8,.85);color:#e8eaed;padding:8px 14px;border-radius:8px;font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;';
      setText(box,text);
      host.appendChild(box);
      (document.fullscreenElement ?? playerRoot()).appendChild(host);
      setTimeout(() => host.remove(), 3200);
    }

    /** 词卡「继续问」：附加词卡表达与可靠原字幕（可带已有释义），不发新查询。 */
    async function continueAskFromVideo(source: SourceDescriptor, cue: Cue, index: number, ctx: {
      snapshot: { expression: string };
      definition: string | null;
    }): Promise<void> {
      const expression = ctx.snapshot.expression.trim();
      if (!expression) return;
      const candidate: SelectionCandidate = {
        at: Date.now(),
        pageUrl: location.href,
        text: expression,
        kind: 'word',
        expression,
        lang: lastTrackLang || undefined,
        source,
        cue: { index, text: cue.text, startMs: cue.start, endMs: cue.start + cue.dur },
        ...(ctx.definition ? { definition: ctx.definition } : {}),
      };
      const built = materialFromCandidate(candidate);
      if (!built) { playerToast(message('字幕尚未就绪，等字幕出现后再继续问')); return; }
      const r = await send<{ ok: boolean; panelOpened?: boolean }>({
        type: 'chatEnsure',
        source,
        material: built.material,
        quote: built.quote,
        openPanel: true,
      });
      popup.close(); // 沿用弹窗关闭后的播放恢复规则
      if (!r?.ok) { playerToast(message('附加失败，请重试')); return; }
      if (!r.panelOpened) {
        // Chrome 不总允许从内容脚本消息代开侧栏；全屏时同样如此。
        // 引用已保存，退出全屏点扩展图标即可续上。
        playerToast(message('已带入引用：点浏览器工具栏的扩展图标打开侧栏继续'));
      }
    }

    /** 词卡「继续问」（页面正文）：附加表达与可靠原句（可带已有释义），按 article 源入对话。 */
    async function continueAskFromPageBody(ctx: {
      snapshot: { expression: string; sentence?: string };
      definition: string | null;
    }): Promise<void> {
      const source = buildPageArticleSource();
      const expression = ctx.snapshot.expression.trim();
      const sentence = (ctx.snapshot.sentence ?? '').replace(/\s+/g, ' ').trim();
      if (!expression) return;
      // 页面正文词/短语：表达为焦点、可靠原句为背景；没有可靠原句只附加表达
      const candidate: SelectionCandidate = {
        at: Date.now(),
        pageUrl: location.href,
        text: expression,
        kind: 'word',
        expression,
        lang: detectTextLanguage(expression) ?? undefined,
        ...(sentence && sentence !== expression ? { sentence } : {}),
        source,
        ...(ctx.definition ? { definition: ctx.definition } : {}),
      };
      const built = materialFromCandidate(candidate);
      if (!built) { playerToast(message('无法提取材料：先在正文里选中一段文字')); return; }
      const r = await send<{ ok: boolean; panelOpened?: boolean }>({
        type: 'chatEnsure',
        source,
        material: built.material,
        quote: built.quote,
        openPanel: true,
      });
      popup.close();
      if (!r?.ok) { playerToast(message('附加失败，请重试')); return; }
      if (!r.panelOpened) {
        playerToast(message('已带入引用：点浏览器工具栏的扩展图标打开侧栏继续'));
      }
    }

    function neighborsText(items: Cue[], index: number): string {
      const parts: string[] = [];
      const prev = items[index - 1];
      const next = items[index + 1];
      if (prev) parts.push(prev.text);
      if (next) parts.push(next.text);
      return parts.join(' / ').slice(0, 300);
    }

    function openLookup(expression: string, index: number, anchor?: HTMLElement, compact = false): void {
      externalLookupToken='';
      const cue = cues[index], source = buildVideoSource();
      if (!cue || !source?.video || pendingTrack) return;
      const lookupGeneration = generation;
      const video = getVideo();
      // 查词时暂停正在播放的视频；只记一次，恢复见 closeResume
      if (video && !video.paused && !pausedByUsVideo) {
        pausedByUsVideo = currentVideoId;
        video.pause();
        log('pause-for-lookup', { videoId: currentVideoId });
      }
      const snapshot: VideoSnapshot = {
        source: 'video',
        expression,
        sentence: cue.text,
        neighbors: neighborsText(cues, index) || undefined,
        title: document.title,
        lang: lastTrackLang || undefined,
        video: {
          videoId: currentVideoId,
          trackId: lastTrackId,
          trackKind: lastTrack === 'asr' ? 'asr' : 'manual',
          trackLang: lastTrackLang,
          startMs: cue.start,
        },
      };
      activeWord = anchor ?? null;
      popup.open({
        snapshot, anchor, compact,
        subLine: `YouTube · ${fmtClock(cue.start)} · ${lastTrackLang}${lastTrack === 'asr' ? `(${tr('自动')})` : `(${tr('人工')})`}`,
        onContinueAsk: (ctx) => {
          if (lookupGeneration === generation && !pendingTrack && currentVideoId === videoIdFromLocation()) {
            void continueAskFromVideo(source, cue, index, ctx);
          }
        },
        onClose: () => {
          // 只恢复：由本次查词暂停 && 仍是同一视频 && 仍处于暂停
          activeWord = null;
          const v = getVideo();
          const byUs = pausedByUsVideo;
          pausedByUsVideo = null;
          if (byUs && byUs === currentVideoId && v && v.paused && !apHeld) {
            void v.play();
            log('resume-after-lookup', { videoId: currentVideoId });
          }
        },
      });
      const card = popup.host()?.shadowRoot?.querySelector<HTMLElement>('.card');
      card?.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
      card?.addEventListener('pointerleave', scheduleCardClose);
    }

    // ---- 时间循环：currentTime 定位 + 翻译调度 ------------------------------------

    function tick(renderImmediately = false): void {
      try {
        const v = getVideo();
        if (!v) return;
        bindPlayListener();
        const t = v.currentTime * 1000;
        const adPlaying = v.closest('#movie_player')?.classList.contains('ad-showing');
        const block = adPlaying ? -1 : cueIndexAt(blocks, t);
        const covering = blockCueIndices[block];
        if (!covering?.includes(pinnedIndex)) pinnedIndex = -1;
        if (adPlaying) apIndex = -1;
        if (autoPause && acquiringForView && !adPlaying && !pendingTrack && !v.paused && !v.seeking) {
          const armed = blocks[apIndex];
          if (armed && t >= armed.start + armed.dur) {
            apLastStopped = apIndex; apIndex = -1;
            apHeld = true; pausedByUsVideo = null; v.pause();
          } else if (apIndex < 0 && block >= 0 && block !== apLastStopped) apIndex = block;
        }
        const heldCues = apHeld && block < 0 ? blockCueIndices[apLastStopped] : undefined;
        const unit = block >= 0 ? cueIndexAt(layout.unitsByBlock[block] ?? [], t) : -1;
        const activeCue = layout.unitsByBlock[block]?.[unit]?.parts[0]?.cue;
        const idx = pinnedIndex >= 0 ? pinnedIndex : activeCue ?? covering?.[0] ??
          (heldCues?.includes(currentIdx) ? currentIdx : heldCues?.[0] ?? -1);
        if (idx !== currentIdx || block !== currentBlock || unit !== currentUnit) {
          currentUnit = unit;
          currentIdx = idx;
          currentBlock = block;
          if (renderImmediately) renderBar(); else queueRender();
          renderBadge();
        }
        if (idx >= 0 || pendingCues.size) scheduleTranslate();
      } catch {
        /* ignore */
      }
    }

    function stopFallbackTranslation(): void {
      fallbackEpoch++;
      if (requestId) void send({ type: 'cancelOnline', requestId });
      requestId = null; translating = false;
      fallbackRetryAt = 0;
    }

    function stopTranslation(): void {
      translationEpoch++;
      stopFallbackTranslation();
      pendingCues.clear();
      queuedBlock = -1;
      postToInject({ type: 'translation-cancel' });
      platformRequest = null;
      if (platformState === 'waiting') platformState = 'idle';
      if (platformTimer) clearTimeout(platformTimer);
      platformTimer = null;
    }

    function clearTranslationResults(): void {
      records.A.clear(); records.B.clear(); platformBlocks = [];
      failedCues.clear();
    }

    function resetSubtitleView(nextBlocks: SourceFragment[], nextSource: string, lang = '') {
      generation = crypto.randomUUID();
      blocks = nextBlocks; sourceRevision = nextSource; revision = '';
      shownBeforeSegmentation.clear();
      layout = buildSubtitleUnits(blocks, [], [], lang, targetLangOf());
      currentUnit = -1;
      cues = []; blockRanges = []; blockCueIndices = [];
      currentIdx = currentBlock = pinnedIndex = -1; rowSeekTime = null;
      closeSelectionActions?.();
      pausedByUsVideo = null; popup.close(true);
      apIndex = apLastStopped = -1; apHeld = false;
      stopTranslation(); platformState = 'idle'; clearTranslationResults();
    }

    function bindLearningCues(next: LearningCue[], ranges: typeof blockRanges, lang: string) {
      cues = next;
      blockRanges = ranges;
      layout = buildSubtitleUnits(blocks, ranges, next, lang, targetLangOf(), shownBeforeSegmentation);
      let first = 0;
      blockCueIndices = ranges.map(range => {
        while (first < cues.length && cues[first]!.to <= range.from) first++;
        const indices: number[] = [];
        for (let i = first; i < cues.length && cues[i]!.from < range.to; i++) indices.push(i);
        return indices;
      });
    }

    async function updateVideoSession(patch: { mode?: 'regular' | 'ai'; autoPause?: boolean; fullTranslation?: boolean } = {}): Promise<void> {
      if (modeBusy || !currentVideoId) return;
      modeBusy = true;
      const videoId = currentVideoId;
      if (patch.mode) stopTranslation();
      ensureSwitchHost();
      const r = await send<{ ok:boolean; mode:'regular' | 'ai'; autoPause:boolean; fullTranslation?:boolean }>({ type:'subtitleMode', videoId, ...patch });
      if (videoId !== currentVideoId) return;
      modeBusy = false;
      if (!r?.ok) { settingsFailed = true; modeReady = false; renderBar(); return; }
      if (translationMode !== r.mode) {
        stopTranslation(); clearTranslationResults(); platformState = 'idle';
      }
      const nextVariant = r.fullTranslation ? 'B' : 'A';
      if (nextVariant !== variant) {
        stopTranslation();
        failedCues.clear();
        variant = nextVariant;
      }
      translationMode = r.mode; autoPause = r.autoPause; modeReady = true; settingsFailed = false;
      if (!autoPause) apIndex = -1;
      renderBar(); scheduleTranslate();
    }
    async function setTranslationMode(mode: 'regular' | 'ai'): Promise<void> {
      await updateVideoSession({ mode });
    }

    async function refreshSettings(): Promise<void> {
      const r = await send<{ ok: boolean; settings: Settings }>({ type: 'getSettings' });
      if (!r?.ok) { settingsFailed = true; renderBar(); return; }
      settingsFailed = false;
      const next: Settings = { ...DEFAULT_SETTINGS, ...r.settings };
      const previousTarget = targetLangOf();
      settings = next; settingsReady = true;
      const targetChanged = previousTarget !== targetLangOf();
      if (targetChanged) {
        layout = buildSubtitleUnits(blocks, blockRanges, cues, lastTrackLang, targetLangOf(), shownBeforeSegmentation);
        stopTranslation(); clearTranslationResults(); platformState = 'idle';
      }
      setDisplayLanguage(settings.displayLanguage,browser.i18n.getUILanguage());
      applyPlayerVisibility(settings.bilingualEnabled);
      zhVisible = settings.chineseVisible;
      syncSubtitleDemand();
      if (!modeReady) await updateVideoSession();
      renderBar();
      if (targetChanged) { queueRender(); scheduleTranslate(); }
    }

    function targetLangOf(): string {
      return settings.defaultComprehensionLang;
    }

    function requestPlatform(): void {
      platformState = 'waiting';
      queueRender();
      const epoch = translationEpoch;
      const targetLang = targetLangOf();
      const key = JSON.stringify([DISPLAY_CUE_VERSION, currentVideoId, lastTrackId, targetLang, revision]);
      void send<{ok: boolean; cues?: Cue[]}>({ type: 'captionCache', key }).then(cached => {
        if (epoch !== translationEpoch) return;
        if (cached?.cues?.length) {
          applyPlatformCues(cached.cues);
          platformState = 'done'; scheduleTranslate(); return;
        }
        platformRequest = { id: crypto.randomUUID(), cacheKey: key, targetLang };
        postToInject({ type: 'translation-request', requestId: platformRequest.id, videoId: currentVideoId, trackId: lastTrackId, targetLang });
        platformTimer = setTimeout(() => {
          if (epoch !== translationEpoch) return;
          postToInject({ type: 'translation-cancel' }); platformRequest = null; platformState = 'done'; scheduleTranslate();
        }, 26000);
      });
    }

    function applyPlatformCues(translated: Cue[]) {
      platformBlocks = translated;
    }

    function scheduleTranslate(): void {
      if (pendingTrack || !settingsReady || !modeReady || modeBusy || !translationDemand() || !lastTrackId) return;
      for (const i of visibleSubtitleIndices()) {
        if (cues[i] && !cues[i].segmentationFallback && !records[variant].has(i) && !failedCues.has(i)) pendingCues.add(i);
      }
      if (queuedBlock !== currentBlock) {
        queuedBlock = currentBlock;
        const covered = blockCueIndices[currentBlock];
        if (covered?.length) {
          const end = Math.min(cues.length, covered.at(-1)! + 5);
          for (let i = Math.max(0, covered[0]! - 1); i < end; i++) {
            if (!cues[i]!.segmentationFallback && !records[variant].has(i) && !failedCues.has(i)) pendingCues.add(i);
          }
        }
      }
      if (translating || fallbackRetryAt > Date.now() || !pendingCues.size) return;
      if (translationMode === 'regular' && platformState !== 'done') {
        if (platformState === 'idle') requestPlatform();
        return;
      }
      const ordered = new Set([currentIdx, ...(blockCueIndices[currentBlock] ?? []), ...visibleSubtitleIndices(), ...pendingCues]);
      const items: SubtitleTranslationItem[] = [];
      for (const id of ordered) {
        if (!pendingCues.has(id)) continue;
        const cue = cues[id]!;
        const parts = layout.partsByCue[id] ?? [];
        if (!parts.length) { failedCues.add(id); pendingCues.delete(id); continue; }
        items.push({id, text: cue.text, from: cue.from, to: cue.to, parts: parts.map(part => {
          const platformText = translationMode === 'regular' ? platformLineForPart(part, blocks, platformBlocks) : undefined;
          return platformText ? {...part, platformText} : part;
        })});
        if (items.length === 8) break;
      }
      if (!items.length) return;
      translating = true;
      queueRender();
      const epoch = fallbackEpoch;
      requestId = crypto.randomUUID();
      void send<SubtitleTranslationReply>({
        type: 'translateCues', mode: translationMode, variant, revision, requestId, videoId: currentVideoId, trackId: lastTrackId,
        sourceLang: lastTrackLang || undefined, targetLang: targetLangOf(),
        items,
      }).then(r => {
        if (epoch !== fallbackEpoch) return;
        requestId = null; translating = false;
        const deferred = new Set(r?.deferred);
        if (deferred.size) {
          const failure = r.ok ? r.failure : r;
          fallbackRetryAt = failure?.error === 'extension-context-invalidated' ? Infinity
            : Math.max(Date.now() + 1_000, failure?.retryAt ?? Date.now() + 5_000);
        } else fallbackRetryAt = 0;
        const results = new Map(r?.ok ? r.translations.map(result => [result.id, result] as const) : []);
        for (const {id} of items) {
          if (deferred.has(id)) continue;
          pendingCues.delete(id);
          const translated = results.get(id);
          if (translated) {
            records[variant].set(id, translated);
            failedCues.delete(id);
          } else failedCues.add(id);
        }
        queueRender();
        scheduleTranslate();
      });
    }

    // 后台标签页降频轮询：隐藏 500ms / 可见 50ms，恢复可见立即对齐一次
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    function restartTickTimer(): void {
      if (tickTimer !== null) clearInterval(tickTimer);
      tickTimer = setInterval(tick, document.hidden ? 500 : 50);
    }
    document.addEventListener('visibilitychange', () => {
      restartTickTimer();
      if (document.hidden) closeSelectionActions?.();
      else tick();
    });
    restartTickTimer();

    // ---- 全屏：把字幕栏与弹窗宿主放进全屏元素（不靠堆 z-index） -------------------

    document.addEventListener('fullscreenchange', () => {
      closeSelectionActions?.(); pausedByUsVideo = null; popup.close(true); renderBar();
    });
    window.addEventListener('resize', queueRender);

    // ---- 侧栏直达消息（字幕视图 / 播放控制） ---------------------------------------

    browser.runtime.onMessage.addListener(
      (msg: unknown, _sender, sendResponse) => {
        const m = msg as Partial<SubControlMessage> | { type?: string } | undefined;
        if (!m || typeof m.type !== 'string') return undefined;
        if (m.type === 'ai-service-changed') {
          if (translationMode === 'ai') {
            stopTranslation(); clearTranslationResults();
            scheduleTranslate(); queueRender();
          }
          return undefined;
        }
        if (m.type === 'pd-video-action') {
          const a = m as SubtitleRowAction;
          const cue = cues[a.index];
          if (pendingTrack || !Number.isInteger(a.index) || a.videoId !== currentVideoId || currentVideoId !== videoIdFromLocation() ||
            a.trackId !== lastTrackId || a.generation !== generation || !cue || a.text !== cue.text) {
            sendResponse({ ok: false });
            return true;
          }
          if(a.action==='pauseLookup'&&typeof a.token==='string') {
            externalLookupToken=a.token;popup.close();const v=getVideo();
            if(v&&!v.paused){pausedByUsVideo=currentVideoId;v.pause();}
          }
          else if(a.action==='resumeLookup'&&a.token===externalLookupToken){
            externalLookupToken='';const v=getVideo(),byUs=pausedByUsVideo;pausedByUsVideo=null;
            if(v?.paused&&byUs===currentVideoId&&!apHeld)void v.play();
          }
          else if(a.action==='seek')seekCue(a.index,!!a.play);
          else if(a.action==='save') {
            if ((a.vaultId !== null && typeof a.vaultId !== 'string') || (a.removeId !== null && typeof a.removeId !== 'string')) {
              sendResponse({ok:false}); return true;
            }
            void writeSentence(a.index,a.vaultId,a.removeId).then(sendResponse); return true;
          }
          else if(a.action==='lookup' && typeof a.word==='string' && a.word.length<=200)openLookup(a.word,a.index);
          sendResponse({ok:true});return true;
        }
        if (m.type === 'pd-video-settings-get') { sendResponse(videoSettingsState()); return true; }
        if (m.type === 'pd-video-settings-set') {
          const command = m as VideoSettingsCommand;
          if (!currentVideoId || command.videoId !== currentVideoId || command.generation !== generation) {
            sendResponse({ok:false, error:'video-mismatch'}); return true;
          }
          const change = command.change;
          if ('trackId' in change) {
            const target = tracklist.find(track => track.id === change.trackId);
            if (!target) { sendResponse({ok:false, error:'track-unavailable'}); return true; }
            pendingTrack = target; closeSelectionActions?.(); notice = ''; nocuesReason = '';
            stopTranslation(); clearAcquisitionTimer();
            if (acquiringForView) { ensureCaptionsOn(20); sendConfig(target); }
            renderBar();
            sendResponse({ok:true}); return true;
          }
          if (!modeReady || modeBusy || ('mode' in change && !['regular','ai'].includes(change.mode)) ||
              ('autoPause' in change && (typeof change.autoPause !== 'boolean' || !blocks.length))) {
            sendResponse({ok:false, error:'not-ready'}); return true;
          }
          void updateVideoSession(change).then(() => sendResponse({ok:currentVideoId===command.videoId && modeReady && !settingsFailed}));
          return true;
        }
        if (m.type === 'blc-sub-get') {
          const v = getVideo();
          const relevant = [...(blockCueIndices[currentBlock] ?? []), ...visibleSubtitleIndices()];
          const waiting = relevant.some(i => pendingCues.has(i));
          const failed = relevant.some(i => failedCues.has(i));
          const state: SubViewState = {
            type: 'blc-sub-state',
            videoId: currentVideoId,
            title: document.title,
            trackKind: lastTrack === 'asr' ? 'asr' : cues.length ? 'manual' : '',
            trackLang: lastTrackLang,
            translationLang: targetLangOf(),
            trackId: lastTrackId,
            generation,
            cues: cues.map((c, i) => ({
              id: i,
              startMs: c.start,
              endMs: c.start + c.dur,
              text: c.text,
              zh: sentenceTranslation(i) ?? null,
              translationSource: sentenceSource(i),
              joinBefore: i && c.from > cues[i - 1]!.to ? ' ' : '',
              from: c.from,
              to: c.to,
            })),
            fullTranslation: variant === 'B',
            translationBusy: translationDemand() && waiting && fallbackRetryAt <= Date.now(),
            translationFailed: failed || (fallbackRetryAt > Date.now() && waiting),
            degradedFull: variant === 'B' && translationMode === 'regular',
            chineseVisible: showTranslation(),
            currentIndex: currentIdx,
            playing: !!v && !v.paused,
            notice,
          };
          sendResponse(state);
          return true;
        }
        if (m.type === 'blc-sub-control') {
          const c = m as SubControlMessage;
          if (c.videoId !== currentVideoId || c.videoId !== videoIdFromLocation() || (c.generation && c.generation !== generation)) {
            sendResponse({ ok: false, error: 'video-mismatch' });
            return true;
          }
          if (c.action === 'fullTranslation') {
            if (!modeReady || modeBusy || !cues.length || typeof c.enabled !== 'boolean') {
              sendResponse({ok:false}); return true;
            }
            void updateVideoSession({fullTranslation:c.enabled}).then(() => sendResponse({ok:!settingsFailed}));
            return true;
          }
          if (c.action === 'retryTranslation') {
            stopTranslation(); failedCues.clear(); scheduleTranslate(); queueRender();
            sendResponse({ok:true}); return true;
          }
          const v = getVideo();
          if (!v) {
            sendResponse({ ok: false, error: 'no-video' });
            return true;
          }
          try {
            if (c.action === 'retrySubtitles') retrySubtitleSource();
            else if (c.action === 'seek' && typeof c.timeMs === 'number') {
              seekTo(c.timeMs, -1, false);
            } else if (c.action === 'togglePlay') {
              if (v.paused) void v.play();
              else v.pause();
            } else if (c.action === 'replay') {
              tick();
              const block = blocks[currentBlock >= 0 ? currentBlock : apHeld ? apLastStopped : -1];
              if (block) seekTo(block.start, currentIdx, true);
            } else if (c.action === 'next' || c.action === 'prev') {
              tick();
              const target = currentIdx < 0 ? 0 :
                Math.min(cues.length - 1, Math.max(0, currentIdx + (c.action === 'next' ? 1 : -1)));
              seekCue(target, false, true);
            }
          } catch {
            sendResponse({ok:false,error:'not-ready'});
            return true;
          }
          sendResponse({ ok: true });
          return true;
        }
        // M5 问答：来源描述与按需材料（当前轨道英文字幕，不等待中文翻译）
        if (m.type === 'blc-chat-source') {
          const info = buildChatSourceInfo();
          sendResponse(info);
          return true;
        }
        if (m.type === 'blc-chat-material') {
          sendResponse({ type: 'blc-chat-material-info', material: buildVideoMaterial() });
          return true;
        }
        return undefined;
      },
    );

    // ---- 词状态（字幕词标记）：索引 + 广播同步 -------------------------------------

    async function refreshSurfaceStatus(): Promise<void> {
      const r = await send<{ ok: boolean; items?: VocabIndexItem[] }>({
        type: 'vocabIndex',
      });
      if (r?.ok && Array.isArray(r.items)) {
        // 与页面标记共用语言桶：词条只在同语言轨道文本上标状态
        markBuckets = buildMarkBuckets(r.items);
        queueRender();
      }
    }

    /** 轨道语言下的词状态（按语言规范化；跨语言同形词互不套用）。 */
    function wordStatus(text: string): string | undefined {
      const lang = baseLang(lastTrackLang) || 'en';
      return markBuckets
        .get(lang)
        ?.statusByKey.get(normalizeExpressionInLanguage(text, lang));
    }

    browser.runtime.onMessage.addListener((msg: unknown) => {
      const t = (msg as { type?: string })?.type;
      if (t === 'vocab-changed') { void refreshSurfaceStatus(); }
      if (t === 'settings-changed') void refreshSettings();
      if (t === 'ai-service-changed' && translationMode === 'ai') {
        stopTranslation(); clearTranslationResults(); scheduleTranslate(); queueRender();
      }
    });

    // ---- 站内导航：清旧状态、重新发起 -------------------------------------------

    function onNav(): void {
      const from = currentVideoId;
      const to = videoIdFromLocation();
      if (from === to) return; // 同视频页内导航不算换视频
      boundaryHost.cancel();
      clearAcquisitionTimer();
      postToInject({ type: 'source-cancel', nonce });
      restoreNativeCaptions();
      stopTranslation();
      // 换视频：旧选区候选立即失效（读取侧另有身份校验兜底）
      void send({ type: 'selectionCandidateSet', candidate: null });
      platformState = 'idle';
      translationMode = settings.translationMode; variant = 'A';
      currentVideoId = to;
      modeReady = false; modeBusy = false; autoPause = false; apIndex = -1; apHeld = false; apLastStopped = -1;
      floatingPanel.hide(); translationPopup.close(); selectionPill.reset();
      void updateVideoSession();
      navSeq++;
      cues = [];
      shownBeforeSegmentation.clear();
      blocks = []; blockRanges = []; blockCueIndices = []; layout = {unitsByBlock:[],partsByCue:[]}; currentUnit = -1; currentBlock = -1; sourceRevision = revision = ''; generation = crypto.randomUUID();
      pinnedIndex = -1; rowSeekTime = null;
      lastTrack = '';
      lastTrackLang = '';
      lastTrackId = '';
      tracklist = [];
      pendingTrack = null;
      notice = '';
      nocuesReason = '';
      nocuesRetries = 0;
      clearTranslationResults();
      currentIdx = -1;
      pausedByUsVideo = null;
      // 换视频：旧弹窗直接移除（不触发恢复播放回调）
      popup.close(true);
      removeSubsHost();
      log('clear', { from, to, navSeq });
      acquiringForView = translatingForView = false;
      readers.clear();
      refreshReaderDemand();
      renderBar();
      renderBadge();
    }

    window.addEventListener('yt-navigate-finish', onNav, true);

    // 轮询兜底：yt-navigate-finish 以外的地址变化（如 Shorts 快速滑动）。
    setInterval(() => {
      try {
        const v = videoIdFromLocation();
        if (v && v !== currentVideoId) onNav();
      } catch {
        /* ignore */
      }
    }, 500);

    // 诊断轮询：CC 按钮状态可能被页面或其它扩展随时改变。
    setInterval(readCcDiag, 1500);

    // ---- 接收 MAIN world 的消息 --------------------------------------------------

    window.addEventListener('message', (evt) => {
      try {
        if (evt.source !== window) return;
        const d = evt.data as Partial<InjectMessage> | undefined;
        if (!d || d.source !== INJECT_SOURCE) return;

        // 双重过期闸：消息所属视频 ≠ 当前视频，或请求令牌已过 —— 都丢弃。
        const nowVid = videoIdFromLocation();
        if (d.videoId !== nowVid) {
          log('drop-stale', { msgVideoId: d.videoId, currentVideoId: nowVid });
          return;
        }
        if (typeof d.nonce !== 'number' || d.nonce !== nonce) {
          log('drop-nonce', { msgNonce: d.nonce, currentNonce: nonce });
          return;
        }

        if (d.type === 'subtitle-boundaries') {
          const reply = evt.ports[0];
          if (!reply) return;
          if (!acquiringForView || typeof d.revision !== 'string') {
            reply.postMessage([]);
            reply.close();
            return;
          }
          void boundaryHost.answer(d.revision, d.passages, reply);
          return;
        }
        if (d.type === 'track-selected') {
          if (d.track && d.track.id !== trackOfUrl(lastTrackId)?.id && (pendingTrack || blocks.length)) {
            pendingTrack = d.track;
            if (blocks.length) {
              resetSubtitleView([], '');
              lastTrack = lastTrackLang = lastTrackId = '';
              notice = ''; nocuesReason = ''; nocuesRetries = 0;
            }
            armAcquisitionTimer();
            ensureCaptionsOn(20);
            renderBar();
          }
          return;
        }
        if (d.type === 'translation') {
          const request = platformRequest;
          if (!request || d.requestId !== request.id || d.trackId !== lastTrackId || translationMode !== 'regular') return;
          if (platformTimer) clearTimeout(platformTimer);
          platformRequest = null; platformState = 'done';
          const translated = Array.isArray(d.cues) ? d.cues : [];
          applyPlatformCues(translated);
          if (translated.some(c => c.zh)) void send({ type: 'captionCache', key: request.cacheKey, cues: translated });
          scheduleTranslate();
          return;
        }

        if (d.type === 'tracklist' && Array.isArray(d.tracks)) {
          tracklist = d.tracks.filter(t => typeof t.id === 'string' && typeof t.lang === 'string');
          log('tracklist', { count: tracklist.length, tracks: tracklist });
          renderBar();
          return;
        }

        if ((d.type === 'blocks' || d.type === 'cues') && Array.isArray(d.blocks) && d.blocks.length && typeof d.revision === 'string') {
          const kind = d.trackKind === 'asr' ? 'asr' : 'manual';
          const lang = String(d.trackLang || '').toLowerCase();
          const newTrackId = String(d.trackId || '');
          const rawRevision = d.revision.replace(/-fallback$/, '');
          if (lastTrackId !== newTrackId || sourceRevision !== rawRevision) {
            resetSubtitleView(d.blocks, rawRevision, lang);
          }
          if (d.type === 'cues' && d.revision !== revision) {
            if (!Array.isArray(d.cues) || !Array.isArray(d.blockRanges) || d.blockRanges.length !== blocks.length) return;
            generation = crypto.randomUUID();
            closeSelectionActions?.(); popup.close();
            stopTranslation(); platformState = 'idle'; clearTranslationResults();
            bindLearningCues(d.cues, d.blockRanges, lang);
            revision = d.revision;
          }
          clearAcquisitionTimer();
          pendingTrack = null;
          if (bilingualOn) hideNativeCaptions();
          else restoreNativeCaptions();
          lastTrack = kind;
          lastTrackLang = lang;
          lastTrackId = newTrackId;
          nocuesReason = '';
          nocuesRetries = 0;
          if (typeof d.seen === 'number') sawTimedtext = d.seen;
          notice = d.type === 'cues' && d.segmentationFallback ? SUBTITLE_FALLBACK_NOTICE : '';
          tick();
          log(d.type, {
            videoId: d.videoId,
            track: `${lastTrackLang}(${lastTrack})`,
            count: cues.length,
            first: cues.length ? formatCue(cues[0]!) : '',
          });
          renderBar();
          return;
        }
        if (d.type === 'nocues') {
          // 已有当前视频字幕：保留现状。
          if (cues.length && !pendingTrack) {
            if (typeof d.seen === 'number') sawTimedtext = d.seen;
            log('nocues-ignored-have-cues', { reason: d.reason });
            return;
          }
          nocuesReason = d.reason || 'unknown';
          if (typeof d.seen === 'number') sawTimedtext = d.seen;
          log('nocues', { videoId: d.videoId, reason: nocuesReason, seen: sawTimedtext });
          // 保留整轮期限，单次失败继续等待新的来源；仅沿用一次自动唤醒。
          if (nocuesReason === 'no-timedtext-seen' && nocuesRetries++ < 1) {
            const retryNonce = nonce;
            const retryVideo = currentVideoId;
            sendNudge(); // 播放器 API 强制选轨
            setTimeout(() => {
              if (nonce !== retryNonce || currentVideoId !== retryVideo || cues.length || notice) return;
              ensureCaptionsOn(20);
            }, 800);
            log('nocues-retry', { attempt: nocuesRetries });
          }
        }
      } catch {
        /* ignore */
      }
    });

    // ---- storage 访问隔离探针（验收用） -------------------------------------------

    window.addEventListener('blc-probe-storage', () => {
      void (async () => {
        const root = document.documentElement;
        try {
          await browser.storage.local.get('blc-probe');
          root.setAttribute('data-blc-storage-probe', 'granted');
        } catch (e) {
          root.setAttribute('data-blc-storage-probe', `denied:${String((e as Error)?.message ?? e).slice(0, 80)}`);
        }
      })();
    });

    // ---- 启动 ---------------------------------------------------------------------

    const layoutStyle = document.createElement('style');
    layoutStyle.textContent = `
      #movie_player:has(#blc-subs-switch[data-open]) .ytp-chrome-bottom { opacity:1!important; pointer-events:auto!important; }
      /* 氛围灯画布是定位层；学习区域也需建立绘制层，不能被它盖住。 */
      #blc-learning-layout { min-width:0; position:relative; z-index:1; }
      #blc-learning-layout > :first-child { min-width:0; width:100%!important; }
      #blc-learning-layout > #blc-learning-panel { grid-column:2; grid-row:1 / span 2; }
      #blc-learning-layout #movie_player { width:100%!important; }
      #blc-learning-layout video { max-width:100%; object-fit:contain; }
    `;
    document.head.append(layoutStyle);

    log('boot', { videoId: currentVideoId, url: location.href.slice(0, 120) });
    if (currentVideoId) renderBar();
    void refreshSurfaceStatus();
    void refreshSettings();
    window.addEventListener('pagehide', () => { closeSelectionActions?.(); stopTranslation(); cancelSourceAcquisition(); });
  },
});
