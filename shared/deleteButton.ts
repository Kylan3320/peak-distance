import './deleteButton.css';
import { onDisplayLanguageChange, t } from './i18n';
import { uiIcon } from './uiControls';

export function createDeleteButton({ buttonText = 'Delete', onDelete }: { buttonText?: string; onDelete(): void }) {
  const element = document.createElement('div');
  element.className = 'delete-confirmation';

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'delete-confirm-action';
  const label = document.createElement('span');
  action.append(label);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'delete-confirm-cancel';
  cancel.innerHTML = uiIcon('close');
  element.append(action, cancel);

  let confirming = false;
  function updateLabels() {
    label.textContent = t(confirming ? 'Confirm' : buttonText);
    action.setAttribute('aria-label', label.textContent);
    cancel.setAttribute('aria-label', t('Cancel delete'));
  }
  function setConfirming(value: boolean) {
    confirming = value;
    action.querySelector('svg')?.remove();
    action.insertAdjacentHTML('afterbegin', uiIcon(value ? 'check' : 'trash'));
    cancel.hidden = !value;
    updateLabels();
  }

  action.addEventListener('click', () => {
    if (confirming) {
      setConfirming(false);
      onDelete();
    } else {
      setConfirming(true);
    }
  });
  cancel.addEventListener('click', () => {
    setConfirming(false);
    action.focus();
  });

  setConfirming(false);
  return {
    element,
    dispose: onDisplayLanguageChange(updateLabels),
    reset() { setConfirming(false); },
    setDisabled(disabled: boolean) { action.disabled = disabled; },
  };
}
