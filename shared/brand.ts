import tokens from './tokens.css?inline';
import controls from './controls.css?inline';
export const brandTokens = `${tokens}
  :host { --pd-paper-tile: url('${browser.runtime.getURL('/brand/paper-tile.png')}'); }
`;
export const sharedControls = controls;
export const brandControls = `
  ${controls}
  button,select,input,textarea { font:inherit; box-sizing:border-box; }
  button,select { cursor:pointer; } button { border:1px solid var(--pd-line); border-radius:6px; background:var(--pd-surface); color:var(--pd-ink); padding:6px 10px; }
  button:hover { background:var(--pd-selected); } button:disabled { cursor:wait; opacity:.6; }
  button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible { outline:2px solid var(--pd-blue); outline-offset:2px; }
`;

/**
 * 「添加到对话」单色线性图标（对话气泡＋）：选区浮条 / 字幕选区操作共用。
 * tooltip 与可访问名称由调用方统一为「添加到对话」。
 */
export const CHAT_ADD_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M12 9v6M9 12h6"/></svg>';

