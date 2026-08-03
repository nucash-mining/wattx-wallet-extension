// Approval window: the background worker opens this with query params and
// waits for an approvalResult message. Closing the window = reject.
const q = new URLSearchParams(location.search);
const id = q.get('id');
const kind = q.get('kind') || 'connect';
document.getElementById('origin').textContent = q.get('origin') || 'unknown origin';

if (kind === 'inscribe') {
  document.getElementById('title').textContent = 'Inscribe an ordinal?';
  const det = document.getElementById('det');
  det.classList.remove('hide');
  det.innerHTML =
    `Content type &nbsp;<b>${q.get('ctype') || '?'}</b><br>` +
    `Size &nbsp;<b>${q.get('kb') || '?'} KB</b><br>` +
    `Est. cost &nbsp;<b>${q.get('wtx') || '?'} WTX</b>` +
    (q.get('to') ? `<br>Deliver to &nbsp;<b>${q.get('to')}</b>` : '');
  document.getElementById('sub').textContent =
    'This signs and broadcasts two transactions (commit + reveal) paid from your wallet. It cannot be undone.';
}

let sent = false;
function answer(granted) {
  if (sent) return;
  sent = true;
  chrome.runtime.sendMessage({ method: 'approvalResult', params: { id, granted } });
  window.close();
}
document.getElementById('approve').onclick = () => answer(true);
document.getElementById('reject').onclick = () => answer(false);
window.addEventListener('beforeunload', () => answer(false));
