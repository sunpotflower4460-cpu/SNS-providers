function simplifiedStatus(raw: string) {
  if (raw === 'API接続待機') return '準備OK';
  if (raw === 'ローカルモード' || raw.startsWith('管理キー未設定')) return 'この端末で利用中';
  return raw;
}

export function installStatusPresentation() {
  if (typeof document === 'undefined') return () => undefined;

  const present = () => {
    const status = document.querySelector<HTMLElement>('.status-line');
    if (!status) return;

    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');

    const current = status.textContent?.trim() || '';
    const lastPresented = status.dataset.presentedStatus || '';
    if (!current || current === lastPresented) return;

    const raw = current;
    const presented = simplifiedStatus(raw);
    status.dataset.fullStatus = raw;
    status.dataset.presentedStatus = presented;
    status.title = raw;

    if (presented === raw) return;
    const indicator = status.querySelector('i');
    status.textContent = presented;
    if (indicator) status.prepend(indicator);
  };

  const observer = new MutationObserver(present);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  present();

  return () => observer.disconnect();
}
