import type { VideoSettingsState, VideoSettingsChange } from './messages';
import { localize, message, setText, languageLabel, onDisplayLanguageChange } from './i18n';

export interface VideoSettingsContext {
  active(): boolean;
  tab(): Promise<number | undefined>;
}

/** Only mounted by the workspace; options has no bound video. */
export function mountVideoSettings(root: HTMLElement, context: VideoSettingsContext) {
  root.innerHTML = `<h3 data-i18n="当前视频"></h3><p class="settings-context-title" id="video-settings-title"></p>
    <label class="settings-field"><span data-i18n="原文语言"></span><select id="video-track" data-i18n-aria-label="原文字幕语言"></select></label>
    <label class="settings-field"><span data-i18n="本视频翻译"></span><select id="video-mode" data-i18n-aria-label="本视频翻译方式"><option value="regular" data-i18n="常规翻译"></option><option value="ai" data-i18n="AI 翻译（LLM）"></option></select></label>
    <label class="settings-field"><span data-i18n="逐句暂停（AP）"></span><input id="video-auto-pause" type="checkbox" data-i18n-aria-label="逐句暂停（AP）"></label>
    <p class="settings-status" id="video-settings-status" role="status"></p>`;
  localize(root);
  const track = root.querySelector<HTMLSelectElement>('#video-track')!;
  const mode = root.querySelector<HTMLSelectElement>('#video-mode')!;
  const pause = root.querySelector<HTMLInputElement>('#video-auto-pause')!;
  const status = root.querySelector<HTMLElement>('#video-settings-status')!;
  let current: { tabId: number; state: VideoSettingsState } | null = null;
  let busy = false, polling = false;
  let error = '';
  const send = <T>(tabId: number, payload: unknown): Promise<T | null> => new Promise(resolve => {
    browser.tabs.sendMessage(tabId, payload, (reply: T) => {
      resolve(browser.runtime.lastError ? null : reply ?? null);
    });
  });
  function render() {
    root.hidden = !current;
    if (!current) return;
    const state = current.state;
    setText(root.querySelector('#video-settings-title')!, state.title);
    const key = JSON.stringify(state.tracks);
    if (track.dataset.tracks !== key) {
      track.replaceChildren();
      for (const item of state.tracks) {
        const option = new Option('', item.id);
        setText(option, message('{language} ({kind}){name}', {language:languageLabel(item.lang), kind:message(item.kind === 'asr' ? '自动' : '人工'), name:item.name ? ` · ${item.label || item.name}` : ''}));
        track.add(option);
      }
      if (!state.tracks.length) { const option = new Option('', ''); setText(option,message('暂无可用字幕轨道')); track.add(option); }
      track.dataset.tracks = key;
    }
    if (!busy) track.value = state.trackId;
    track.disabled = busy || !state.tracks.length;
    if (!busy) { mode.value = state.mode; pause.checked = state.autoPause; }
    mode.disabled = busy || !state.ready;
    pause.disabled = busy || !state.ready || !state.hasCues;
    status.classList.toggle('err', !!error);
    setText(status, error ? message(error) : state.switchingTrack ? message('正在切换原文字幕…') : state.notice ? message(state.notice) : '');
  }
  async function refresh() {
    if (!context.active() || busy || polling) return;
    polling = true;
    try {
      const tabId = await context.tab();
      const state = tabId === undefined ? null : await send<VideoSettingsState>(tabId, {type:'pd-video-settings-get'});
      if (!context.active() || busy) return;
      if (tabId !== await context.tab()) { current = null; render(); return; }
      if (current?.tabId !== tabId || current?.state.videoId !== state?.videoId) error = '';
      current = tabId !== undefined && state?.videoId ? {tabId, state} : null;
      render();
    } finally { polling = false; }
  }
  async function change(patch: VideoSettingsChange) {
    if (!current || busy) return;
    const target = current;
    busy = true; error = ''; render();
    try {
      if (!context.active() || target.tabId !== await context.tab()) return;
      const result = await send<{ok:boolean}>(target.tabId, {type:'pd-video-settings-set',videoId:target.state.videoId,generation:target.state.generation,change:patch});
      if (!result?.ok) error = '视频设置未生效，请重试';
    } finally { busy = false; await refresh(); }
  }
  track.onchange = () => void change({trackId:track.value});
  mode.onchange = () => void change({mode:mode.value as 'regular'|'ai'});
  pause.onchange = () => void change({autoPause:pause.checked});
  onDisplayLanguageChange(() => { delete track.dataset.tracks; localize(root); render(); });
  window.setInterval(() => void refresh(), 1000);
  return {refresh};
}
