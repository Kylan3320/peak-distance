import '@/shared/theme.css';
import { mountSettings } from '@/shared/settingsView';
import { initDisplayLanguage, getDisplayLocale, localize, onDisplayLanguageChange, t } from '@/shared/i18n';
await initDisplayLanguage();
const updateLanguage = () => {document.documentElement.lang=getDisplayLocale();document.title=`${t('设置')} — Peak Distance`;localize(document);};
updateLanguage();
onDisplayLanguageChange(updateLanguage);
mountSettings(document.getElementById('settings-body')!);
