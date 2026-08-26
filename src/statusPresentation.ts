function simplifiedStatus(raw: string) {
  if (raw === 'API接続待機') return '準備OK';
  if (raw === 'ローカルモード' || raw.startsWith('管理キー未設定')) return 'この端末で利用中';
  return raw;
}

export function installStatusPresentation() {
  if (typeof document === 'undefined') return () => undefined;

  // Do not rewrite React-owned text nodes. The visible label is projected with a CSS
  // pseudo-element from data-presented-status, while the original React text remains
  // untouched for reconciliation and the full technical status remains available in title.
  const style = document.createElement('style');
  style.dataset.statusPresentation = 'true';
  style.textContent = `
    .status-line[data-presented-status] { font-size: 0 !important; }
    .status-line[data-presented-status]::after {
      content: attr(data-presented-status);
      font-size: var(--status-presented-font-size, 9px);
      line-height: 1.25;
    }
  `;
  document.head.append(style);

  const present = () => {
    const status = document.querySelector<HTMLElement>('.status-line');
    if (!status) return;

    const raw = status.textContent?.trim() || '';
    if (!raw) return;
    const presented = simplifiedStatus(raw);

    if (!status.style.getPropertyValue('--status-presented-font-size')) {
      status.style.setProperty('--status-presented-font-size', getComputedStyle(status).fontSize || '9px');
    }
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.setAttribute('aria-label', presented);
    status.dataset.fullStatus = raw;
    status.dataset.presentedStatus = presented;
    status.title = raw;
  };

  const observer = new MutationObserver(present);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  present();

  return () => {
    observer.disconnect();
    style.remove();
  };
}
