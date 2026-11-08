import { initDisplayLanguage, localize, onDisplayLanguageChange } from '@/shared/i18n';
import './style.css';

const audio = document.querySelector('audio')!;
const failure = document.querySelector<HTMLDivElement>('#failure')!;
const retry = document.querySelector('button')!;
const src = new URLSearchParams(location.search).get('src') ?? '';
// This web-accessible page only plays the dictionary's own media, never arbitrary URLs.
let valid = false;
try {
  const url = new URL(src);
  valid = url.protocol === 'https:' && url.hostname === 'dictionary.cambridge.org' && !url.port &&
    !url.username && !url.password && url.pathname.startsWith('/media/') && /\.(mp3|ogg)$/.test(url.pathname);
} catch { /* A missing or malformed media address is displayed as a playback failure. */ }
if (valid) audio.src = src;
else { failure.hidden = false; retry.hidden = true; }
audio.addEventListener('error', () => { failure.hidden = false; });
audio.addEventListener('playing', () => { failure.hidden = true; });
retry.addEventListener('click', () => {
  failure.hidden = true;
  audio.load();
  void audio.play().catch(() => { failure.hidden = false; });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); parent.postMessage({type:'pd-audio-close'}, '*'); }
}, true);
onDisplayLanguageChange(() => localize(document));
void initDisplayLanguage();
