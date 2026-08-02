// Injected into every page as `window.wattx` — the provider dApps talk to,
// mirroring the Xverse/Unisat surface but for WATTx.
(() => {
  let reqId = 0;
  const pending = new Map();

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.target !== 'wattx-inpage') return;
    const { id, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(result);
  });

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      pending.set(id, { resolve, reject });
      window.postMessage({ target: 'wattx-content', id, method, params }, '*');
    });
  }

  window.wattx = {
    isWattx: true,
    version: '0.1.0',
    // connect → returns the user's WATTx addresses (after they approve in the popup)
    connect: () => rpc('connect'),
    getAccounts: () => rpc('getAccounts'),
    getBalance: () => rpc('getBalance'),
    // inscribe a file as an ordinal: {contentType, dataBase64, toAddress?} → {commitTxid, revealTxid, inscriptionId}
    inscribe: (params) => rpc('inscribe', params),
    // sign+broadcast a plain WTX send: {to, amountSat} → txid
    sendWTX: (params) => rpc('sendWTX', params),
    // sign an arbitrary PSBT (hex) → signed tx hex
    signPsbt: (psbtHex) => rpc('signPsbt', { psbtHex }),
    on: () => {}, // event surface (accountsChanged, etc.) — TODO
  };
  window.dispatchEvent(new Event('wattx#initialized'));
})();
