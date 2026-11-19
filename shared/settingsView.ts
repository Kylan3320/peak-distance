import { isPageShortcut, pageShortcutFromEvent } from './pageShortcut';
import { DEFAULT_SETTINGS, validSetting } from './settings';
import { onAppearanceChange } from './appearance';
import { aiSettingsMarkup, mountAiSettings } from './aiSettingsView';
import { TARGET_LANGUAGES, type LanguageTag } from './languages';
import { authorizeVaultInPage, pickVaultDirectoryInPage } from '@/lib/vault/fs';
import { iconButton, uiIcon } from './uiControls';
import { mountVideoSettings, type VideoSettingsContext } from './videoSettings';
import type { VaultFormatDiagnostic, VaultAccessStatus } from './vault';
import type { VaultConnectResult, VaultMutationResult } from './messages';
import { PAGE_PILL_PREFIX, PILL_PAUSE_KEY, isPillVisibilityKey, type PillVisibilityRule } from './selectionVisibility';
import { DISPLAY_LANGUAGES, DISPLAY_LANGUAGE_NAMES, localize, onDisplayLanguageChange, getDisplayLanguage, getDisplayLocale, t, message, setText, setLocalizedAttribute, languageLabel, type UiText } from './i18n';

/** 理解语言候选：中文区分简繁，其余用主标签。 */
const COMPREHENSION_OPTIONS: LanguageTag[] = [
  'zh-Hans', 'zh-Hant', ...TARGET_LANGUAGES.filter((l) => l !== 'zh'),
];

export async function openVaultPage(action:'authorize'|'connect') {
  await browser.tabs.create({url:browser.runtime.getURL('/options.html')+'?vault='+action});
}

export function mountSettings(root: HTMLElement, videoContext?: VideoSettingsContext) {
  root.innerHTML = `<section class="settings-section"><label class="settings-field"><span data-i18n="外观主题"></span><select id="appearanceTheme"><option value="minimal" data-i18n="简约"></option><option value="classic" data-i18n="经典"></option></select></label></section>
    <section class="settings-section"><h2 data-i18n="语言"></h2>
    <label class="settings-field"><span data-i18n="界面语言"></span><select id="displayLanguage"></select></label>
    <label class="settings-field"><span data-i18n="翻译与释义语言"></span><select id="defaultComprehensionLang"></select></label></section>
    <section class="settings-section page-reading-settings"><h2 data-i18n="整页翻译"></h2>
    <button id="toggle-page-translation" class="page-translate-action" type="button">${uiIcon('translate')}<span data-i18n="翻译或恢复当前网页"></span></button>
    <div class="settings-field"><span data-i18n="网页快捷键"></span><button id="page-translation-command" class="page-keycap" type="button" aria-describedby="shortcut-status" data-i18n-title="更改快捷键">${uiIcon('keyboard')}<kbd></kbd></button></div>
    <div id="shortcut-status" class="settings-status" role="status"></div>
    <div id="page-translation-status" class="settings-status err" role="status"></div>
    <label class="settings-field"><span data-i18n="网页翻译样式"></span><select id="pageTranslationStyle"><option value="parallel" data-i18n="双语直显"></option><option value="frost" data-i18n="磨砂译文"></option><option value="translated" data-i18n="仅看译文"></option></select></label>
    <label class="settings-field"><span data-i18n="网页翻译方式"></span><select id="pageTranslationEngine"><option value="native" data-i18n="浏览器内置翻译"></option><option value="ai" data-i18n="AI 翻译"></option></select></label>
    <button id="prepare-native" class="settings-action" type="button"><span data-i18n="准备内置翻译"></span>${uiIcon('external')}</button></section>
    <section class="settings-section"><h2 data-i18n="查词设置"></h2>
    <label class="settings-field"><span data-i18n="词汇标记"></span><input id="markingEnabled" type="checkbox"></label>
    <label class="settings-field"><span data-i18n="首选词典"></span><select id="primaryDictionary"><option value="youdao" data-i18n="有道"></option><option value="cambridge" data-i18n="剑桥英汉"></option></select></label>
    <label class="settings-field"><span data-i18n="备用词典"></span><select id="backupDictionary"><option value="cambridge" data-i18n="剑桥英汉"></option><option value="youdao" data-i18n="有道"></option></select></label>
    <label class="settings-field"><span data-i18n="无词典结果时自动使用 AI 查词"></span><input id="aiLookupFallback" type="checkbox"></label>
    <details class="settings-details"><summary data-i18n="查询缓存"></summary>
    <label class="settings-field"><span data-i18n="查询缓存上限"></span><input id="cacheLimit" type="number" min="20" max="500" step="1" data-i18n-title="请检查输入范围" aria-describedby="cache-range"></label>
    <span id="cache-range" class="ui-sr-only" data-i18n="请检查输入范围"></span>
    <button id="clear-query-cache" class="settings-action" type="button"><span data-i18n="清除查询缓存"></span>${uiIcon('trash')}${uiIcon('check')}</button><div id="cache-state" class="settings-status err" role="status"></div><span id="cache-announcement" class="ui-sr-only" role="status"></span>
    </details>
    <details id="pill-visibility-settings" class="settings-details" hidden><summary data-i18n="选区浮条"></summary>
    <div id="pill-visibility-rules"></div><div id="pill-visibility-error" class="settings-status err" role="status"></div></details></section>
    <section class="settings-section"><h2 data-i18n="字幕设置"></h2>
    <label class="settings-field"><span data-i18n="默认翻译方式"></span><select id="translationMode"><option value="regular" data-i18n="常规翻译"></option><option value="ai" data-i18n="AI 翻译（LLM）"></option></select></label>
    <label class="settings-field"><span data-i18n="开启双语字幕"></span><input id="bilingualEnabled" type="checkbox"></label>
    <label class="settings-field"><span data-i18n="显示译文字幕"></span><input id="chineseVisible" type="checkbox"></label>
    <label class="settings-field"><span data-i18n="字幕字号"></span><select id="subtitleSize"><option value="small" data-i18n="小"></option><option value="standard" data-i18n="标准"></option><option value="large" data-i18n="大"></option></select></label>
    <div id="video-settings" class="settings-context" hidden></div></section>
    <section class="settings-section vault-section"><div class="vault-head"><h2 id="vault-heading" data-i18n="学习库"></h2><div class="vault-tools">
      <button id="vault-authorize" class="primary" data-i18n="允许访问" hidden></button>
      <button id="vault-connect" class="ui-icon-button" type="button" data-i18n-title="连接学习文件夹" data-i18n-aria-label="连接学习文件夹">${uiIcon('folder')}</button>
      <button id="vault-retry" type="button" data-i18n="重试" hidden></button>
      <button id="vault-disconnect" class="ui-icon-button" data-i18n-title="断开" data-i18n-aria-label="断开" hidden>${uiIcon('disconnect')}</button>
    </div></div>
    <div id="vault-summary" class="vault-summary" hidden><span id="vault-folder" class="hint" hidden></span><span id="vault-pending" class="hint" hidden></span></div>
    <div id="vault-state" class="settings-status" role="status"></div><button id="vault-access-page" class="settings-action" data-i18n="在独立页面授权" hidden></button>
    </section>
    ${aiSettingsMarkup}
    <details class="settings-section settings-details settings-group settings-about"><summary data-i18n="关于"></summary><div class="settings-field"><span data-i18n="版本"></span><span id="version" class="hint"></span></div></details>`;
  localize(root);
  const get = <T extends HTMLElement>(id:string) => root.querySelector<T>(`#${id}`)!;
  const visibilitySettings = get('pill-visibility-settings');
  const visibilityRules = get('pill-visibility-rules');
  const visibilityError = get('pill-visibility-error');
  let visibilityRevision = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  async function refreshPillVisibility() {
    const revision = ++visibilityRevision;
    const storage = browser.storage.local;
    try {
      const [keys, stored] = await Promise.all([storage.getKeys(), storage.get(PILL_PAUSE_KEY)]);
      if (revision !== visibilityRevision) return;
      const until = (stored[PILL_PAUSE_KEY] as PillVisibilityRule | undefined)?.until ?? 0;
      const timeLeft = until - Date.now();
      const rows = keys.filter(key => key.startsWith(PAGE_PILL_PREFIX)).sort().map(key => {
        const url = key.slice(PAGE_PILL_PREFIX.length);
        return visibilityRow(url.replace(/^https:\/\//, ''), url);
      });
      clearTimeout(pauseTimer);
      if (timeLeft > 0) {
        const time = new Intl.DateTimeFormat(getDisplayLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(until);
        rows.unshift(visibilityRow(message('所有网页已暂停至 {time}', {time})));
        pauseTimer = setTimeout(() => void refreshPillVisibility(), timeLeft);
      }
      visibilityRules.replaceChildren(...rows);
      setText(visibilityError, '');
      visibilitySettings.hidden = !rows.length;
    } catch {
      if (revision !== visibilityRevision) return;
      visibilitySettings.hidden = false;
      setText(visibilityError, message('设置读取失败，请重新打开设置重试'));
    }
  }
  function visibilityRow(label: string | UiText, url?: string) {
    const row = document.createElement('div');
    row.className = 'settings-field';
    const caption = document.createElement('span');
    setText(caption, label);
    const restore = document.createElement('button');
    restore.type = 'button';
    setText(restore, message('恢复显示'));
    restore.onclick = async () => {
      restore.disabled = true;
      try {
        const result = await browser.runtime.sendMessage({type:'selectionVisibilityRestore', url}) as {ok: boolean};
        if (!result?.ok) throw new Error('restore-selection-visibility-failed');
        await refreshPillVisibility();
        if (visibilitySettings.hidden) get('markingEnabled').focus({preventScroll:true});
        else visibilitySettings.querySelector('summary')?.focus({preventScroll:true});
      } catch {
        restore.disabled = false;
        setText(visibilityError, message('保存失败，请重试'));
      }
    };
    row.append(caption, restore);
    return row;
  }
  const translationLanguage = get<HTMLSelectElement>('defaultComprehensionLang');
  function setTranslationLanguage(value: string) {
    if (![...translationLanguage.options].some(option => option.value === value)) {
      const option = new Option('', value);
      setText(option, languageLabel(value));
      translationLanguage.add(option);
    }
    translationLanguage.value = value;
  }
  const videoSettings = videoContext ? mountVideoSettings(get('video-settings'), videoContext) : null;
  const pageToggle = get<HTMLButtonElement>('toggle-page-translation');
  pageToggle.hidden = !videoContext;
  const shortcutButton = get<HTMLButtonElement>('page-translation-command');
  const keycap = shortcutButton.querySelector('kbd')!;
  const shortcutStatus = get('shortcut-status');
  let savedShortcut = DEFAULT_SETTINGS.pageTranslationShortcut;
  let recording = false;
  function renderShortcut() {
    shortcutButton.setAttribute('aria-pressed', String(recording));
    setText(keycap, recording ? message('按下组合键') : savedShortcut.split('+').join(' + '));
    setLocalizedAttribute(shortcutButton, 'aria-label', message('更改快捷键 {key}', {key:savedShortcut}));
  }
  function finishRecording() {
    recording = false;
    renderShortcut();
    setText(shortcutStatus, '');
  }
  shortcutButton.onclick = () => {
    if (recording) { finishRecording(); return; }
    recording = true;
    renderShortcut();
    setText(shortcutStatus, message('快捷键录入提示'));
  };
  shortcutButton.onblur = () => { if (recording) finishRecording(); };
  shortcutButton.onkeydown = async event => {
    if (!recording || event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.isComposing) return;
    if (event.key === 'Escape') { finishRecording(); return; }
    const next = pageShortcutFromEvent(event);
    if (!next) { setText(shortcutStatus, message('快捷键录入提示')); return; }
    recording = false;
    shortcutButton.disabled = true;
    try {
      await browser.storage.local.set({pageTranslationShortcut:next});
      savedShortcut = next;
      setText(shortcutStatus, message('快捷键已保存'));
    } catch { setText(shortcutStatus, message('保存失败，请重试')); }
    finally { shortcutButton.disabled = false; renderShortcut(); shortcutButton.focus(); }
  };
  renderShortcut();
  pageToggle.onclick = async () => {
    const status = get('page-translation-status');
    setText(status, '');
    try {
      const id = await videoContext?.tab();
      if (id === undefined) throw new Error('no-page');
      const reply = await browser.tabs.sendMessage(id, {type:'page-translation-toggle'}, {frameId:0});
      if (!reply?.ok) throw new Error('unsupported-page');
    } catch {
      setText(status, message('当前页面不支持段落翻译'));
    }
  };
  get('prepare-native').onclick = () => void browser.runtime.sendMessage({type:'prepareNativeTranslation'});
  const ai = mountAiSettings(get('ai-settings'));
  const themeControl=get<HTMLSelectElement>('appearanceTheme');
  onAppearanceChange(theme=>{themeControl.value=theme;});
  const display = get<HTMLSelectElement>('displayLanguage');
  display.add(new Option(t('跟随浏览器'), 'auto'));
  for (const language of DISPLAY_LANGUAGES) display.add(new Option(DISPLAY_LANGUAGE_NAMES[language], language));
  const clearCache = get<HTMLButtonElement>('clear-query-cache');
  let cacheConfirmation: ReturnType<typeof setTimeout>;
  clearCache.onclick = async () => {
    clearTimeout(cacheConfirmation);
    clearCache.disabled = true;
    clearCache.dataset.cleared = 'false';
    setText(get('cache-state'), '');
    setText(get('cache-announcement'), '');
    try {
      const result = await browser.runtime.sendMessage({type:'clearQueryCache'}) as {ok:boolean};
      if (result?.ok) {
        clearCache.dataset.cleared = 'true';
        setText(get('cache-announcement'), message('查询缓存已清除'));
        cacheConfirmation = setTimeout(() => { clearCache.dataset.cleared = 'false'; }, 1600);
      } else setText(get('cache-state'), message('清除失败，请重试'));
    } catch {setText(get('cache-state'), message('清除失败，请重试'));}
    finally {clearCache.disabled = false;}
  };
  const fields = Object.entries(DEFAULT_SETTINGS).filter(([name]) => name !== 'selectionTranslationMode' && name !== 'pageTranslationShortcut');
  const savedSettings: Record<string, unknown> = {...DEFAULT_SETTINGS};
  async function load() {
    try {
      const stored=await browser.storage.local.get([...Object.keys(DEFAULT_SETTINGS),'deepseekApiKey','aiServices']);
      savedShortcut = isPageShortcut(stored.pageTranslationShortcut) ? stored.pageTranslationShortcut : DEFAULT_SETTINGS.pageTranslationShortcut;
      renderShortcut();
      for(const [name,fallback] of fields) {
        const control=get<HTMLInputElement|HTMLSelectElement>(name),value=validSetting(name,stored[name])?stored[name]:fallback;
        savedSettings[name] = value;
        if (control === translationLanguage) setTranslationLanguage(String(value));
        else if (control instanceof HTMLInputElement && control.type==='checkbox') control.checked=!!value;
        else control.value=String(value);
      }
      ai.load(stored);
    } catch {ai.report('设置读取失败，请重新打开设置重试');}
  }
  for(const [name] of fields) {
    const control=get<HTMLInputElement|HTMLSelectElement>(name);
    const field=control.closest('.settings-field')!;
    const caption=field.querySelector(':scope > span[data-i18n]');
    if(caption)setLocalizedAttribute(control,'aria-label',message(caption.getAttribute('data-i18n')!));
    const status=document.createElement('small');status.className='settings-field-state';status.setAttribute('role','status');field.append(status);
    const reportError = (key: string) => {
      setText(status, key ? message(key) : '');
      status.classList.toggle('err', !!key);
      if (key) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    };
    const checkbox = control instanceof HTMLInputElement && control.type === 'checkbox' ? control : null;
    let attempt = 0;
    control.addEventListener('change',async()=>{
      const current = ++attempt;
      const value = checkbox ? checkbox.checked : name === 'cacheLimit' ? Number(control.value) : control.value;
      if (!validSetting(name, value)) { reportError('请检查输入范围'); return; }
      reportError('');
      try {
        await browser.storage.local.set({[name]:value});
        savedSettings[name] = value;
      } catch {
        if (current !== attempt) return;
        if (checkbox) checkbox.checked = !!savedSettings[name];
        else if (name !== 'cacheLimit') control.value = String(savedSettings[name]);
        reportError('保存失败，请重试');
      }
    });
  }

  for (const tag of COMPREHENSION_OPTIONS) {
    const option = new Option('', tag);
    setText(option, languageLabel(tag));
    translationLanguage.add(option);
  }

  // ---- 学习库：连接 / 断开 / 立即同步 ----------------------------------------------
  let vaultBusy = false;
  let vaultStatus: VaultAccessStatus | null = null;
  let vaultRefresh = 0;
  let vaultFeedback: UiText | null = null;
  let vaultFeedbackError = false;
  let syncFailed = false;
  let vaultFormatDiagnostic: VaultFormatDiagnostic | null = null;
  const authorizationPage = window.top === window && location.pathname === '/options.html';
  const retry = get<HTMLButtonElement>('vault-retry');
  const vaultErrors:Record<string,string>={'not-connected':'请先连接学习文件夹','io':'文件读写失败，未完成的内容仍保留在本机，请重试','format':'学习文档格式有误，请检查文档后重试','conflict':'存在同一记录的修改冲突，双方内容已保留'};
  function rememberVaultDiagnostic(result: {ok:boolean;syncError?:string;formatDiagnostic?:VaultFormatDiagnostic}|null) {
    if(result?.formatDiagnostic)vaultFormatDiagnostic=result.formatDiagnostic;
    else if(result?.ok&&!result.syncError){vaultFormatDiagnostic=null;if(vaultFeedbackError){vaultFeedback=null;vaultFeedbackError=false;}}
  }
  function vaultDiagnosticNotice():UiText|null {
    if(!vaultFormatDiagnostic)return null;
    const reasons:Record<string,string>={
      'material format':'材料格式无效','chat format':'对话格式无效','missing material':'缺少引用的材料版本',
      'vocab':'词汇格式无效','sentence':'句子格式无效','sentence source':'句子来源无效',
      'knowledge':'知识记录格式无效','knowledge metadata':'知识记录格式无效','knowledge body':'知识记录格式无效','duplicate knowledge':'知识记录重复',
    };
    const reason=vaultFormatDiagnostic.reason.replace(/^Error: format: /,'');
    const reasonKey=reasons[reason]??(/^(?:生词本|句子|知识点)\.md$|^missing record separator in /.test(reason)?'集合格式无效':vaultErrors.format!);
    return message('文档格式有误：{path}（{reason}）',{path:vaultFormatDiagnostic.path,reason:message(reasonKey)});
  }
  function showVaultNotice(text:string|UiText,error=false) {
    setText(get('vault-state'),text);get('vault-state').classList.toggle('err',error);
  }
  const connectVault = get<HTMLButtonElement>('vault-connect');
  function showVaultStatus(status: UiText, color: 'idle' | 'ready' | 'attention', lastSync?: UiText, connected = false) {
    const action = message(connected ? '更换文件夹' : '连接学习文件夹');
    connectVault.dataset.connection = color;
    setLocalizedAttribute(connectVault, 'aria-label', action);
    setLocalizedAttribute(connectVault, 'aria-description', status);
    setLocalizedAttribute(connectVault, 'title', message('{action} · {status}', { action, status: lastSync ?? status }));
  }
  async function refreshVault():Promise<VaultAccessStatus|null> {
    if(vaultBusy)return null;
    const request=++vaultRefresh;
    const wasConnected = !!vaultStatus?.connected;
    try{
      const r=await browser.runtime.sendMessage({type:'vaultStatus'}) as {ok?:boolean;status?:VaultAccessStatus}|null;
      if(request!==vaultRefresh||vaultBusy)return null;
      const s=r?.status; vaultStatus=s??null;
      if(!s){
        showVaultStatus(message('状态读取失败'), 'attention', undefined, wasConnected);
        retry.hidden=false;
        showVaultNotice(message('状态读取失败'),true);
        return null;
      }
      const needsAccess=s.connected&&s.permission!=='granted';
      const accessFailed = !!s.accessError || needsAccess;
      const status = message(!s.connected ? '未连接。' : s.accessError ? '访问状态读取失败' :
        s.permission === 'prompt' ? '需要授权' : s.permission === 'denied' ? '访问未获允许' : '已连接');
      const lastSync=s.lastCommitAt ? message('上次同步 {time}',{time:new Intl.DateTimeFormat(getDisplayLocale(),{dateStyle:'short',timeStyle:'short'}).format(s.lastCommitAt)}) : undefined;
      const error=s.lastError?(vaultErrors[s.lastError]?message(vaultErrors[s.lastError]!):s.lastError):null;
      const failed = !!(syncFailed || error || vaultFormatDiagnostic || vaultFeedbackError);
      showVaultStatus(!accessFailed && failed ? message('同步未完成') : status, !s.connected ? 'idle' : accessFailed || failed ? 'attention' : 'ready',
        accessFailed || failed ? undefined : lastSync, s.connected);
      get('vault-summary').hidden=!s.folderName&&s.pendingCount===0;
      get('vault-folder').hidden=!s.folderName;setText(get('vault-folder'),s.folderName??'');
      get('vault-pending').hidden=s.pendingCount===0;
      setText(get('vault-pending'),message('待同步 {count} 项',{count:s.pendingCount}));
      get('vault-authorize').hidden=!needsAccess||!!s.accessError;
      get('vault-disconnect').hidden=!s.connected;
      const access=s.accessError?message('访问状态读取失败'):
        s.connected&&s.permission==='denied'?message('访问未获允许'):null;
      retry.hidden=!(s.accessError||s.connected&&!needsAccess&&(syncFailed||error));
      showVaultNotice(!get('vault-access-page').hidden?vaultFeedback??access??'':access??vaultDiagnosticNotice()??error??vaultFeedback??'',!!s.accessError||s.permission==='denied'||!!vaultFormatDiagnostic||!!error||vaultFeedbackError);
      return s;
    }catch{
      if(request===vaultRefresh){
        vaultStatus=null;
        showVaultStatus(message('状态读取失败'), 'attention', undefined, wasConnected);
        retry.hidden=false;
        showVaultNotice(message('状态读取失败，请重试'),true);
      }
      return null;
    }
  }
  function setVaultBusy(busy:boolean) {
    vaultBusy=busy;vaultRefresh++;
    for(const id of ['vault-connect','vault-authorize','vault-retry','vault-disconnect','vault-access-page'])get<HTMLButtonElement>(id).disabled=busy;
  }
  get('vault-access-page').onclick=()=>void openVaultPage(vaultStatus?.connected?'authorize':'connect');
  function accessFailure(error:unknown) {
    const reason=error instanceof Error?error.message:String(error);
    const name=error instanceof Error?error.name:'';
    const pageRequired=reason==='authorization-page'||name==='SecurityError';
    get('vault-access-page').hidden=!pageRequired;
    vaultFeedbackError=reason!=='no-permission';
    vaultFeedback=reason==='no-permission'?null:pageRequired?message('请在独立设置页允许文件夹访问'):name==='NotAllowedError'?message('访问未获允许'):name==='NotFoundError'?message('文件夹不可用，请确认位置或更换文件夹'):vaultErrors[reason]?message(vaultErrors[reason]!):message('文件夹操作失败：{error}',{error:reason});
  }
  async function flushVault(quiet=false) {
    let r: (VaultMutationResult&{committed?:number;updated?:number;deleted?:number})|null;
    try {
      r=await browser.runtime.sendMessage({type:'vaultFlush'});
      rememberVaultDiagnostic(r);
      if(!r?.ok)throw new Error(r?.error??'io');
    }catch(error){syncFailed=true;throw error;}
    syncFailed=false;
    vaultFeedbackError=false;get('vault-access-page').hidden=true;
    const { committed = 0, updated = 0, deleted = 0 } = r;
    vaultFeedback=quiet||!(committed||updated||deleted)?null:message('同步完成：写入 {written} 项，读回 {read} 项，移除 {deleted} 项',{written:committed,read:updated,deleted});
  }
  get('vault-connect').addEventListener('click',async()=>{
    if(vaultBusy)return;
    if(!authorizationPage){await openVaultPage('connect');return;}
    setVaultBusy(true);showVaultNotice(message('请选择学习文件夹…'));
    try{
      const picked=await pickVaultDirectoryInPage();
      if(picked){
        showVaultNotice(message('正在连接…'));
        const r=await browser.runtime.sendMessage({type:'vaultConnect'}) as VaultConnectResult|null;
        rememberVaultDiagnostic(r);
        if(!r?.ok)throw new Error(r?.error??'io');
        syncFailed=!!r.syncError;
        vaultFeedbackError=!!r.syncError;
        vaultFeedback=r.syncError?message('同步未完成：{error}',{error:vaultErrors[r.syncError]?message(vaultErrors[r.syncError]!):r.syncError}):null;
      }
    }catch(error){accessFailure(error);}
    finally{setVaultBusy(false);await refreshVault();}
  });
  const authorizeAndSync=async()=>{
    if(vaultBusy)return;
    if(!authorizationPage){await openVaultPage('authorize');return;}
    setVaultBusy(true);showVaultNotice(message('如有「每次访问都允许」，请选择该项。'));
    try{
      if(await authorizeVaultInPage()!=='granted')throw new Error('no-permission');
      showVaultNotice(message('正在同步…'));
      await flushVault();
    }catch(error){accessFailure(error);}
    finally{setVaultBusy(false);await refreshVault();}
  };
  get('vault-authorize').onclick=()=>void authorizeAndSync();
  retry.onclick=()=>void syncOnActivity(true);
  get('vault-disconnect').addEventListener('click',async()=>{
    if(vaultBusy)return;
    setVaultBusy(true);
    try{await browser.runtime.sendMessage({type:'vaultDisconnect'});vaultFeedback=null;vaultFeedbackError=false;vaultFormatDiagnostic=null;syncFailed=false;get('vault-access-page').hidden=true;}
    catch(error){accessFailure(error);}
    finally{setVaultBusy(false);await refreshVault();}
  });
  browser.runtime.onMessage.addListener((msg:unknown)=>{
    if((msg as {type?:string})?.type==='vault-changed')void refreshVault();
  });
  let activitySync = false;
  async function syncOnActivity(explicit=false):Promise<void> {
    if(activitySync||vaultBusy||document.visibilityState==='hidden'||!root.checkVisibility())return;
    activitySync=true;
    let ownsBusy=false;
    try{
      const status=await refreshVault();
      if(!status?.connected||status.permission!=='granted'||vaultBusy)return;
      setVaultBusy(true);ownsBusy=true;
      await flushVault(!explicit);
    }catch(error){accessFailure(error);}
    finally{activitySync=false;if(ownsBusy)setVaultBusy(false);await refreshVault();}
  }
  window.addEventListener('focus',()=>void syncOnActivity());
  document.addEventListener('visibilitychange',()=>void syncOnActivity());
  if(root.checkVisibility())void syncOnActivity();else void refreshVault();
  const vaultAction=new URL(location.href).searchParams.get('vault');
  if(vaultAction==='authorize'||vaultAction==='connect')void refreshVault().then(()=>{
    get('vault-heading').scrollIntoView({block:'center'});
    get(vaultAction==='authorize'&&!get('vault-authorize').hidden?'vault-authorize':'vault-connect').focus({preventScroll:true});
  });
  get('version').textContent=`v${browser.runtime.getManifest().version}`;
  onDisplayLanguageChange(()=>{
    display.value=getDisplayLanguage();
    localize(root);
    display.options[0]!.textContent=t('跟随浏览器');
    for (const option of translationLanguage.options) setText(option, languageLabel(option.value));
    ai.localize();
    void refreshPillVisibility();
    void refreshVault();
  });
  browser.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if (changes.pageTranslationShortcut) {
      const next = changes.pageTranslationShortcut.newValue;
      savedShortcut = isPageShortcut(next) ? next : DEFAULT_SETTINGS.pageTranslationShortcut;
      renderShortcut();
    }
    if (Object.keys(changes).some(isPillVisibilityKey)) void refreshPillVisibility();
    for(const [name] of fields){
      if(!changes[name]||!validSetting(name,changes[name].newValue))continue;
      const control=get<HTMLInputElement|HTMLSelectElement>(name),value=changes[name].newValue;
      savedSettings[name]=value;
      if (control === translationLanguage) setTranslationLanguage(String(value));
      else if (control instanceof HTMLInputElement && control.type==='checkbox') control.checked=!!value;
      else control.value=String(value);
    }
  });
  void load();
  void refreshPillVisibility();
  return {refresh:async()=>{await load();void videoSettings?.refresh();void syncOnActivity();},showAi:ai.show};
}
