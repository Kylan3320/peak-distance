import { DEFAULT_SETTINGS, validSetting } from './settings';
import { onAppearanceChange } from './appearance';
import { AI_PRESETS, defaultAiProfile, normalizeAiBaseUrl, readAiServices, validateAiProfile, type AiProfile, type AiProvider, type AiServices, type AiProtocol } from './aiConfig';
import { TARGET_LANGUAGES, langDisplayName, primaryOfLang, type LanguageTag } from './languages';
import { authorizeVaultInPage, pickVaultDirectoryInPage } from '@/lib/vault/fs';
import { iconButton, uiIcon } from './uiControls';
import type { VaultFormatDiagnostic, VaultStatus } from './vault';
import type { VaultConnectResult, VaultMutationResult } from './messages';
import { DISPLAY_LANGUAGES, DISPLAY_LANGUAGE_NAMES, localize, onDisplayLanguageChange, getDisplayLanguage, getDisplayLocale, t, message, setText, setLocalizedAttribute, languageLabel, type UiText } from './i18n';

/** 理解语言候选：中文区分简繁，其余用主标签。 */
const COMPREHENSION_OPTIONS: LanguageTag[] = [
  'zh-Hans', 'zh-Hant', ...TARGET_LANGUAGES.filter((l) => l !== 'zh'),
];

export function mountSettings(root: HTMLElement) {
  root.innerHTML = `<section class="settings-section"><label class="settings-field"><span data-i18n="外观主题"></span><select id="appearanceTheme"><option value="minimal" data-i18n="简约"></option><option value="classic" data-i18n="经典"></option></select></label></section>
    <section class="settings-section"><h2 data-i18n="语言"></h2>
    <label class="settings-field"><span data-i18n="显示语言"></span><select id="displayLanguage"></select></label>
    <label class="settings-field"><span data-i18n="默认理解语言"></span><select id="defaultComprehensionLang"></select></label>
    <details class="settings-details"><summary data-i18n="单独设置"></summary>
      <div id="lang-overrides"></div>
      <div class="language-rule"><label><span data-i18n="原文语言"></span><select id="override-source"></select></label><label><span data-i18n="默认理解语言"></span><select id="override-target"></select></label><button id="override-add" class="ui-icon-button" type="button" disabled>${uiIcon('add')}</button></div>
      <div id="lang-state" class="settings-status err" role="status"></div>
    </details></section>
    <section class="settings-section"><h2 data-i18n="查词设置"></h2>
    <label class="settings-field"><span data-i18n="词汇标记"></span><input id="markingEnabled" type="checkbox"></label>
    <label class="settings-field"><span data-i18n="首选词典"></span><select id="primaryDictionary"><option value="youdao" data-i18n="有道"></option><option value="cambridge" data-i18n="剑桥英汉"></option></select></label>
    <label class="settings-field"><span data-i18n="备用词典"></span><select id="backupDictionary"><option value="cambridge" data-i18n="剑桥英汉"></option><option value="youdao" data-i18n="有道"></option></select></label>
    <label class="settings-field"><span data-i18n="无词典结果时自动使用 AI 查词"></span><input id="aiLookupFallback" type="checkbox"></label>
    <details class="settings-details"><summary data-i18n="查询缓存"></summary>
    <label class="settings-field"><span data-i18n="查询缓存上限"></span><input id="cacheLimit" type="number" min="20" max="500" step="1" data-i18n-title="请检查输入范围" aria-describedby="cache-range"></label>
    <span id="cache-range" class="ui-sr-only" data-i18n="请检查输入范围"></span>
    <button id="clear-query-cache" class="settings-action" type="button"><span data-i18n="清除查询缓存"></span>${uiIcon('trash')}${uiIcon('check')}</button><div id="cache-state" class="settings-status err" role="status"></div><span id="cache-announcement" class="ui-sr-only" role="status"></span>
    </details></section>
    <section class="settings-section"><h2 data-i18n="字幕设置"></h2>
    <label class="settings-field"><span data-i18n="默认翻译方式"></span><select id="translationMode"><option value="regular" data-i18n="常规翻译"></option><option value="ai" data-i18n="AI 翻译（LLM）"></option></select></label>
    <label class="settings-field"><span data-i18n="开启双语字幕"></span><input id="bilingualEnabled" type="checkbox"></label>
    <label class="settings-field"><span data-i18n="显示译文字幕"></span><input id="chineseVisible" type="checkbox"></label>
    <label class="settings-field"><span data-i18n="字幕字号"></span><select id="subtitleSize"><option value="small" data-i18n="小"></option><option value="standard" data-i18n="标准"></option><option value="large" data-i18n="大"></option></select></label></section>
    <section class="settings-section vault-section"><h2 data-i18n="学习库"></h2>
    <div class="vault-overview"><div class="vault-summary"><span id="vault-label"></span><span id="vault-pending" class="hint" hidden></span><span id="vault-time" class="ui-sr-only"></span></div><div class="vault-tools"><button id="vault-connect" class="primary"><span id="vault-connect-label" data-i18n="连接学习文件夹"></span><span id="vault-folder-icon" hidden>${uiIcon('folder')}</span></button><button id="vault-flush" class="ui-icon-button" aria-describedby="vault-time" hidden>${uiIcon('sync')}</button><button id="vault-disconnect" class="ui-icon-button" hidden>${uiIcon('disconnect')}</button></div></div>
    <div id="vault-state" class="settings-status" role="status"></div>
    </section>
    <details id="ai-settings" class="settings-section settings-details settings-group ai-section"><summary data-i18n="AI 服务"></summary>
    <fieldset id="ai-fields"><div class="ai-form-row"><label for="ai-provider" data-i18n="服务商"></label><div class="ai-control"><select id="ai-provider" aria-describedby="ai-current"></select><p id="ai-current" class="hint" hidden></p></div></div>
    <div class="ai-form-row"><label for="key" data-i18n="API Key"></label><div class="ai-control"><div class="ai-key-control"><input id="key" class="settings-key" type="password" autocomplete="off" spellcheck="false"><button id="clear" class="ui-icon-button ui-danger" type="button" hidden>${uiIcon('trash')}</button></div></div></div>
    <details id="ai-advanced" class="settings-details"><summary data-i18n="高级设置"></summary>
      <label class="ai-field"><span data-i18n="接口格式"></span><select id="ai-protocol"><option value="openai" data-i18n="OpenAI 兼容"></option><option value="anthropic">Anthropic Messages</option><option value="gemini">Gemini</option></select></label>
      <label class="ai-field"><span data-i18n="API 地址（Base URL）"></span><input id="ai-url" type="url" placeholder="https://api.example.com/v1" spellcheck="false"></label>
      <label class="ai-field"><span data-i18n="模型 ID"></span><input id="ai-model" type="text" spellcheck="false"></label>
    </details><div class="ai-footer"><button id="save" class="ui-icon-button" type="button">${uiIcon('save')}</button><div id="state" class="settings-status" role="status"></div></div></fieldset></details>
    <details class="settings-section settings-details settings-group"><summary data-i18n="翻译设置"></summary>
    <label class="settings-field"><span data-i18n="常规翻译来源"></span><select id="regularTranslation"><option value="browser-native" data-i18n="浏览器内置翻译"></option><option value="google-gtx" data-i18n="Google 免费翻译"></option></select></label><button id="prepare-native" class="settings-action" type="button"><span data-i18n="准备内置翻译"></span>${uiIcon('external')}</button></details>
    <details class="settings-section settings-details settings-group settings-about"><summary data-i18n="关于"></summary><div class="settings-field"><span data-i18n="版本"></span><span id="version" class="hint"></span></div></details>`;
  localize(root);
  const get = <T extends HTMLElement>(id:string) => root.querySelector<T>(`#${id}`)!;
  get('prepare-native').onclick = () => void browser.runtime.sendMessage({type:'prepareNativeTranslation', sourceLang:'en', targetLang:get<HTMLSelectElement>('defaultComprehensionLang').value});
  const showAi = (reveal = false) => {
    const section = get<HTMLDetailsElement>('ai-settings');
    section.open = true;
    if (reveal) section.scrollIntoView({block:'start'});
  };
  const reportAi = (key: string, error = false) => {
    const status = get('state');
    setText(status, key ? message(key) : '');
    status.classList.toggle('err', error);
    if (error) showAi();
  };
  const themeControl=get<HTMLSelectElement>('appearanceTheme');
  onAppearanceChange(theme=>{themeControl.value=theme;});
  for(const [id,label] of [['override-add','添加覆盖'],['vault-flush','立即同步'],['vault-disconnect','断开'],['clear','清除当前 Key'],['save','保存并使用']] as const) {
    setLocalizedAttribute(get(id), 'title', message(label));
    setLocalizedAttribute(get(id), 'aria-label', message(label));
  }
  const display = get<HTMLSelectElement>('displayLanguage');
  display.add(new Option(t('跟随浏览器'), 'auto'));
  for (const language of DISPLAY_LANGUAGES) display.add(new Option(DISPLAY_LANGUAGE_NAMES[language], language));
  let services: AiServices = {active:'deepseek',profiles:{}};
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
  let selected: AiProvider = 'deepseek';
  const provider = get<HTMLSelectElement>('ai-provider');
  const providerLabel = (value: AiProvider) => ['glm','kimi','custom'].includes(value) ? t(AI_PRESETS[value].label) : AI_PRESETS[value].label;
  for (const value of Object.keys(AI_PRESETS) as AiProvider[]) provider.add(new Option(providerLabel(value), value));
  const drafts = new Map<AiProvider, {profile:AiProfile;keyInput:string}>();
  function updateKeyControls() {
    const saved=services.profiles[selected];let reusable=false;
    try{reusable=!!saved?.apiKey&&saved.protocol===get<HTMLSelectElement>('ai-protocol').value&&normalizeAiBaseUrl(saved.baseUrl)===normalizeAiBaseUrl(get<HTMLInputElement>('ai-url').value);}catch{/* incomplete URL */}
    get('clear').hidden=!saved?.apiKey;
    setLocalizedAttribute(get('key'), 'placeholder', message(reusable?'已保存；留空保留当前 Key':saved?.apiKey?'地址或接口已变更，请填写对应 Key':'输入所选服务的 API Key'));
  }
  function draft(): AiProfile {
    const baseUrl=get<HTMLInputElement>('ai-url').value.trim();
    const protocol=get<HTMLSelectElement>('ai-protocol').value as AiProtocol;
    const saved=services.profiles[selected];
    let reusable=false;
    try {reusable=!!saved&&saved.protocol===protocol&&normalizeAiBaseUrl(saved.baseUrl)===normalizeAiBaseUrl(baseUrl);} catch { /* incomplete URL */ }
    return {protocol,baseUrl,model:get<HTMLInputElement>('ai-model').value.trim(),apiKey:get<HTMLInputElement>('key').value.trim()||(reusable?saved!.apiKey:'')};
  }
  function showActiveAi() {
    const active=services.profiles[services.active];
    get('ai-current').hidden=!active?.apiKey;
    get('ai-current').textContent=active?.apiKey?t('当前使用：{provider} · {model}',{provider:providerLabel(services.active),model:active.model}):'';
  }
  function showAiState() {
    const saved=services.profiles[selected]??defaultAiProfile(selected),current=draft();
    const changed=(['protocol','baseUrl','model','apiKey'] as const).some(key=>current[key]!==saved[key]);
    get('save').classList.toggle('is-pending',changed||selected!==services.active||!saved.apiKey);
    if(changed)reportAi('尚未保存');
    else if(!saved.apiKey)reportAi('未配置');
    else if(selected!==services.active)reportAi('保存后切换至此服务');
    else reportAi('');
  }
  function showProvider() {
    const pending=drafts.get(selected);
    const p=pending?.profile??services.profiles[selected]??defaultAiProfile(selected);
    provider.value=selected;get<HTMLSelectElement>('ai-protocol').value=p.protocol;
    get<HTMLInputElement>('ai-url').value=p.baseUrl;get<HTMLInputElement>('ai-model').value=p.model;
    get<HTMLInputElement>('key').value=pending?.keyInput??'';
    updateKeyControls();
    get<HTMLDetailsElement>('ai-advanced').open=selected==='custom';
    showActiveAi();showAiState();
  }
  provider.addEventListener('change',()=>{drafts.set(selected,{profile:draft(),keyInput:get<HTMLInputElement>('key').value});selected=provider.value as AiProvider;showProvider();});
  for(const id of ['key','ai-url','ai-model'])get(id).addEventListener('input',()=>{updateKeyControls();showAiState();});
  get('ai-protocol').addEventListener('change',()=>{updateKeyControls();showAiState();});
  let aiLoaded = false;
  const savedSettings: Record<string, unknown> = {...DEFAULT_SETTINGS};
  async function load() {
    try {
      const stored=await browser.storage.local.get([...Object.keys(DEFAULT_SETTINGS),'deepseekApiKey','aiServices']);
      for(const [name,fallback] of Object.entries(DEFAULT_SETTINGS)) {
        if(name==='comprehensionOverrides')continue; // 对象值由覆盖编辑器单独处理
        const control=get<HTMLInputElement|HTMLSelectElement>(name),value=validSetting(name,stored[name])?stored[name]:fallback;
        savedSettings[name] = value;
        if(control instanceof HTMLInputElement && control.type==='checkbox')control.checked=!!value;else control.value=String(value);
      }
      renderOverrides(validSetting('comprehensionOverrides',stored.comprehensionOverrides)?(stored.comprehensionOverrides as Record<string,string>):{});
      get<HTMLSelectElement>('override-target').value=get<HTMLSelectElement>('defaultComprehensionLang').value;
      updateRuleChoices();
      const next = readAiServices(stored);
      if (!aiLoaded) {
        aiLoaded=true;services=next;selected=services.active;showProvider();
      } else if (JSON.stringify(next) !== JSON.stringify(services)) {
        services=next;showActiveAi();updateKeyControls();showAiState();
      }
    } catch {reportAi('设置读取失败，请重新打开设置重试',true);}
  }
  for(const name of Object.keys(DEFAULT_SETTINGS)) {
    if(name==='comprehensionOverrides')continue;
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

  // ---- 语言：理解语言与按源语言覆盖 ------------------------------------------------
  const fillLangOptions=(select:HTMLSelectElement,includeUnd:boolean)=>{
    select.replaceChildren();
    for(const tag of COMPREHENSION_OPTIONS){const o=document.createElement('option');o.value=tag;o.textContent=langDisplayName(tag);select.appendChild(o);}
    if(includeUnd){const o=document.createElement('option');o.value='und';o.textContent=t('待确认');select.appendChild(o);}
  };
  fillLangOptions(get<HTMLSelectElement>('defaultComprehensionLang'),false);
  {
    const source=get<HTMLSelectElement>('override-source');
    source.add(new Option(t('选择语言'), ''));
    for(const tag of TARGET_LANGUAGES) source.add(new Option(langDisplayName(tag), tag));
    source.add(new Option(t('待确认'), 'und'));
    fillLangOptions(get<HTMLSelectElement>('override-target'),false);
    get<HTMLSelectElement>('override-target').add(new Option(t('选择语言'), ''), 0);
  }
  function updateRuleChoices() {
    const source=get<HTMLSelectElement>('override-source').value,target=get<HTMLSelectElement>('override-target');
    for(const option of target.options) option.disabled=!!source&&!!option.value&&primaryOfLang(source)===primaryOfLang(option.value);
    if(target.selectedOptions[0]?.disabled) target.value='';
    get<HTMLButtonElement>('override-add').disabled=!source||!target.value;
  }
  get('override-source').addEventListener('change',updateRuleChoices);
  get('override-target').addEventListener('change',updateRuleChoices);
  let currentOverrides: Record<string,string> = {};
  let ruleBusy = false;
  async function changeRule(source: string, target?: string): Promise<Record<string,string> | null> {
    if (ruleBusy) return null;
    ruleBusy = true;
    setText(get('lang-state'), '');
    try {
      const stored = await browser.storage.local.get('comprehensionOverrides');
      const current = (stored.comprehensionOverrides ?? {}) as Record<string,string>;
      const next = target === undefined ? {...current} : Object.fromEntries(Object.entries(current).map(([language, value]) => [primaryOfLang(language), value]));
      if (target === undefined) delete next[source];
      else next[source] = target;
      if (!validSetting('comprehensionOverrides', next)) {
        setText(get('lang-state'), message('覆盖无效'));
        return null;
      }
      await browser.storage.local.set({comprehensionOverrides:next});
      return next;
    } catch {
      setText(get('lang-state'), message('保存失败，请重试'));
      return null;
    } finally { ruleBusy = false; }
  }
  function renderOverrides(overrides:Record<string,string>) {
    currentOverrides=overrides;
    const box=get('lang-overrides');box.replaceChildren();
    for(const [src,target] of Object.entries(overrides)){
      const row=document.createElement('div');row.className='language-rule-item';
      const label=document.createElement('span');label.textContent=`${langDisplayName(src)} → ${langDisplayName(target)}`;row.appendChild(label);
      const remove=iconButton('trash',message('移除'));remove.classList.add('ui-danger');
      remove.addEventListener('click',async()=>{
        const next = await changeRule(src);
        if (!next) return;
        const focused = document.activeElement === remove;
        renderOverrides(next);
        if (focused) get('override-source').focus({preventScroll:true});
      });
      row.appendChild(remove);box.appendChild(row);
    }
  }
  get('override-add').addEventListener('click',async()=>{
    const source=get<HTMLSelectElement>('override-source'),target=get<HTMLSelectElement>('override-target');
    const src = source.value, dest = target.value;
    const next = await changeRule(src, dest);
    if (!next) return;
    renderOverrides(next);
    if (source.value === src && target.value === dest) {
      if (document.activeElement === get('override-add')) source.focus({preventScroll:true});
      source.value = '';
      target.value = get<HTMLSelectElement>('defaultComprehensionLang').value;
      updateRuleChoices();
    }
  });

  // ---- 学习库：连接 / 断开 / 立即同步 ----------------------------------------------
  let vaultBusy = false;
  let vaultFeedback: UiText | null = null;
  let vaultFeedbackError = false;
  let vaultFormatDiagnostic: VaultFormatDiagnostic | null = null;
  const vaultErrors:Record<string,string>={'not-connected':'请先连接学习文件夹','no-permission':'未获得文件夹读写权限，请重新连接并允许访问','io':'文件读写失败，未完成的内容仍保留在本机，请重试','format':'学习文档格式有误，请检查文档后重试','conflict':'存在同一记录的修改冲突，双方内容已保留'};
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
  async function refreshVault():Promise<void> {
    if(vaultBusy)return;
    try{
      const r=await browser.runtime.sendMessage({type:'vaultStatus'}) as {ok?:boolean;status?:VaultStatus}|null;
      const s=r?.status;
      if(!s){showVaultNotice(vaultDiagnosticNotice()??message('状态读取失败'),true);return;}
      const reconnect=s.connected&&s.lastError==='no-permission';
      setText(get('vault-label'),message(reconnect?'需要重新连接':s.connected?'已连接':'未连接。'));
      get('vault-pending').hidden=s.pendingCount===0;
      setText(get('vault-pending'),message('待同步 {count} 项',{count:s.pendingCount}));
      const lastSync=s.lastCommitAt ? message('上次同步 {time}',{
        time:new Intl.DateTimeFormat(getDisplayLocale(),{dateStyle:'short',timeStyle:'short'}).format(s.lastCommitAt),
      }) : null;
      setText(get('vault-time'),lastSync??'');
      setLocalizedAttribute(get('vault-flush'),'title',lastSync ? message('{source} · {text}',{source:message('立即同步'),text:lastSync}) : message('立即同步'));
      const connect=get<HTMLButtonElement>('vault-connect'),compact=s.connected&&!reconnect;
      connect.className=compact?'ui-icon-button':'primary';
      get('vault-connect-label').hidden=compact;
      get('vault-folder-icon').hidden=!compact;
      const connectLabel=message(reconnect?'重新连接文件夹':compact?'更换文件夹':'连接学习文件夹');
      setText(get('vault-connect-label'),connectLabel);
      setLocalizedAttribute(connect,'title',connectLabel);setLocalizedAttribute(connect,'aria-label',connectLabel);
      get('vault-disconnect').hidden=!s.connected;get('vault-flush').hidden=!s.connected;
      const error=s.lastError?(vaultErrors[s.lastError]?message(vaultErrors[s.lastError]!):s.lastError):null;
      showVaultNotice(vaultDiagnosticNotice()??error??vaultFeedback??'',!!vaultFormatDiagnostic||!!error||vaultFeedbackError);
    }catch{showVaultNotice(vaultDiagnosticNotice()??message('状态读取失败，请重试'),true);}
  }
  get('vault-connect').addEventListener('click',async()=>{
    showVaultNotice(message('请选择学习文件夹…'));
    let picked=false;
    try{picked=await pickVaultDirectoryInPage();}catch(error){showVaultNotice(message('连接失败：{error}',{error:error instanceof Error?error.message:String(error)}),true);return;}
    if(!picked){showVaultNotice(message('未选择目录（或当前页面不支持），未做更改。'));return;}
    showVaultNotice(message('正在连接…'));
    try{
      const r=await browser.runtime.sendMessage({type:'vaultConnect'}) as VaultConnectResult|null;
      rememberVaultDiagnostic(r);
      vaultFeedbackError=!r?.ok||!!r.syncError;
      vaultFeedback=r?.ok
        ? r.syncError?message('同步未完成：{error}',{error:vaultErrors[r.syncError]?message(vaultErrors[r.syncError]!):r.syncError}):null
        : message('连接失败：{error}',{error:r?.error??message('未知错误')});
    }catch{vaultFeedbackError=true;vaultFeedback=message('连接失败，请重试；重新点击可再次授权。');}
    await refreshVault();
  });
  get('vault-disconnect').addEventListener('click',async()=>{
    try{await browser.runtime.sendMessage({type:'vaultDisconnect'});vaultFeedback=null;vaultFeedbackError=false;vaultFormatDiagnostic=null;}
    catch{showVaultNotice(message('断开失败，请重试'),true);return;}
    await refreshVault();
  });
  get('vault-flush').addEventListener('click',async()=>{
    if(vaultBusy)return;
    vaultBusy=true;
    get<HTMLButtonElement>('vault-flush').disabled=true;
    showVaultNotice(message('正在同步…'));
    try{
      if(await authorizeVaultInPage()!=='granted')throw new Error('no-permission');
      const r=await browser.runtime.sendMessage({type:'vaultFlush'}) as (VaultMutationResult&{committed?:number;updated?:number;deleted?:number})|null;
      rememberVaultDiagnostic(r);
      if(!r?.ok)throw new Error(r?.error??'io');
      vaultFeedbackError=false;
      vaultFeedback=message('同步完成：写入 {written} 项，读回 {read} 项，移除 {deleted} 项',{written:r.committed??0,read:r.updated??0,deleted:r.deleted??0});
    }catch(error){vaultFeedbackError=true;const reason=error instanceof Error?error.message:String(error);vaultFeedback=vaultErrors[reason]?message(vaultErrors[reason]):message('同步失败：{error}',{error:reason});}
    finally{vaultBusy=false;get<HTMLButtonElement>('vault-flush').disabled=false;await refreshVault();}
  });
  browser.runtime.onMessage.addListener((msg:unknown)=>{
    if((msg as {type?:string})?.type==='vault-changed')void refreshVault();
  });
  void refreshVault();
  let activitySync = false;
  async function syncOnActivity():Promise<void> {
    if(activitySync||document.visibilityState==='hidden')return;
    activitySync=true;
    try{
      const r=await browser.runtime.sendMessage({type:'vaultSync'}) as VaultMutationResult|null;
      rememberVaultDiagnostic(r);
      await refreshVault();
    }catch{ /* Manual sync reports actionable errors. */ }
    finally{activitySync=false;}
  }
  window.addEventListener('focus',()=>void syncOnActivity());
  document.addEventListener('visibilitychange',()=>void syncOnActivity());
  void syncOnActivity();
  get('save').addEventListener('click',async()=>{
    const profile=draft(),error=validateAiProfile(profile);
    if(error){reportAi(error,true);return;}
    profile.baseUrl=normalizeAiBaseUrl(profile.baseUrl);
    const target=selected;get<HTMLFieldSetElement>('ai-fields').disabled=true;
    try {
      // Keep the permissions request in the click gesture, before storage awaits.
      const allowed=await browser.permissions.request({origins:[`${new URL(profile.baseUrl).origin}/*`]});
      if(!allowed){reportAi('未获得该 API 地址的访问权限，配置未更改。再次保存可重试。',true);return;}
      const latest=readAiServices(await browser.storage.local.get(['aiServices','deepseekApiKey']));
      const next:AiServices={active:target,profiles:{...latest.profiles,[target]:profile}};
      await browser.storage.local.set({aiServices:next});
      services=readAiServices(await browser.storage.local.get('aiServices'));
      selected=services.active;drafts.delete(target);showProvider();
    } catch {reportAi('保存失败，请重试；新地址需要允许浏览器访问',true);}
    finally {get<HTMLFieldSetElement>('ai-fields').disabled=false;}
  });
  get('clear').addEventListener('click',async()=>{
    const target=selected;get<HTMLFieldSetElement>('ai-fields').disabled=true;
    try{const latest=readAiServices(await browser.storage.local.get(['aiServices','deepseekApiKey']));latest.profiles[target]={...latest.profiles[target]??defaultAiProfile(target),apiKey:''};await browser.storage.local.set({aiServices:latest});if(target==='deepseek')await browser.storage.local.remove('deepseekApiKey');services=readAiServices(await browser.storage.local.get('aiServices'));drafts.delete(target);showProvider();}catch{reportAi('清除失败，请重试',true);}finally{get<HTMLFieldSetElement>('ai-fields').disabled=false;}
  });
  get('version').textContent=`v${browser.runtime.getManifest().version}`;
  onDisplayLanguageChange(()=>{
    display.value=getDisplayLanguage();
    localize(root);
    display.options[0]!.textContent=t('跟随浏览器');
    for(const id of ['defaultComprehensionLang','override-source','override-target']) {
      for(const option of get<HTMLSelectElement>(id).options) setText(option,option.value?languageLabel(option.value):message('选择语言'));
    }
    for(const option of provider.options) option.textContent=providerLabel(option.value as AiProvider);
    showActiveAi();
    updateKeyControls();renderOverrides(currentOverrides);
    void refreshVault();
  });
  void load();return {refresh:load,showAi};
}
