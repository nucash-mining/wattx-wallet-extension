// Content script: injects inpage.js and bridges page <-> background service worker.
const s = document.createElement('script');
s.src = chrome.runtime.getURL('dist/inpage.js');
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);

window.addEventListener('message', async (e) => {
  if (e.source !== window || !e.data || e.data.target !== 'wattx-content') return;
  const { id, method, params } = e.data;
  try {
    const result = await chrome.runtime.sendMessage({ method, params, origin: location.origin });
    if (result && result.error) throw new Error(result.error);
    window.postMessage({ target: 'wattx-inpage', id, result: result?.result }, '*');
  } catch (err) {
    window.postMessage({ target: 'wattx-inpage', id, error: err.message }, '*');
  }
});
