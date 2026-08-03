// Background service worker — holds the key, derives addresses, signs, and
// orchestrates ordinal inscription. Self-custody: the private key never leaves
// the extension. Reads UTXOs and broadcasts via a WATTx UTXO API (see UTXO_API).
import { ECPair, WATTX, addressesFromKey, prepareCommit, buildRevealSigned,
         MIN_POSTAGE, WATTX_MIN_FEERATE, WATTX_MIN_FEE, estRevealVsize, toXOnly,
         newMnemonic, keyFromMnemonic } from './wattx.js';
import * as bitcoin from 'bitcoinjs-lib';

// WATTx UTXO/ordinals indexer API (address UTXOs + broadcast). This backend is
// the one piece that must be stood up publicly (Blockbook/Esplora-style over
// wattxd) for the wallet to work without the user running a node.
const UTXO_API = 'https://ord-api.wattxchange.app'; // live (pm2 wattx-utxo-api + ord-relay → Oracle nginx)

// --- key storage (encrypted at rest with a user passphrase; simplified here) ---
async function getKey() {
  const { wifKey } = await chrome.storage.local.get('wifKey');
  if (!wifKey) throw new Error('No wallet — create or import one first');
  return ECPair.fromWIF(wifKey, WATTX);
}
async function setKey(keyPair) {
  await chrome.storage.local.set({ wifKey: keyPair.toWIF() });
}

async function api(path, body) {
  const res = await fetch(UTXO_API + path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  if (!res.ok) throw new Error(`UTXO API ${path}: ${res.status}`);
  return res.json();
}

// Fund the commit: build+sign a tx spending the user's UTXOs to the commit address.
async function fundCommit(keyPair, commitAddress, amountSat) {
  const from = addressesFromKey(keyPair).segwit;
  const utxos = await api(`/address/${from}/utxo`);       // [{txid, vout, value, ...}]
  const psbt = new bitcoin.Psbt({ network: WATTX });
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: WATTX });
  let inSat = 0;
  const feeReserve = 50000; // funding-tx fee at WATTx rates
  for (const u of utxos) {
    psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: p2wpkh.output, value: u.value } });
    inSat += u.value;
    if (inSat >= amountSat + feeReserve) break;
  }
  if (inSat < amountSat + feeReserve) throw new Error('Insufficient WTX to inscribe');
  psbt.addOutput({ address: commitAddress, value: amountSat });
  const change = inSat - amountSat - feeReserve;
  if (change > MIN_POSTAGE) psbt.addOutput({ address: from, value: change });
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  const txid = (await api('/tx', { hex: tx.toHex() })).txid;
  return { txid, vout: 0, value: amountSat };
}

async function doInscribe({ contentType, dataBase64, toAddress }, origin) {
  const keyPair = await getKey();
  const to = toAddress || addressesFromKey(keyPair).taproot;
  const data = Buffer.from(dataBase64, 'base64');
  const internal = ECPair.makeRandom({ network: WATTX });
  const commit = prepareCommit(internal, contentType, data);
  const revealFee = Math.max(estRevealVsize(commit.leafScript.length) * WATTX_MIN_FEERATE, WATTX_MIN_FEE);
  const fund = MIN_POSTAGE + revealFee + 10000;

  // every inscription needs an explicit user approval — it spends real WTX
  const ok = await requestApproval('inscribe', origin, {
    ctype: contentType, kb: (data.length / 1024).toFixed(1),
    wtx: ((fund + 50000) / 1e8).toFixed(4), ...(toAddress ? { to: toAddress } : {}),
  });
  if (!ok) throw new Error('User rejected the inscription');

  const c = await fundCommit(keyPair, commit.address, fund);
  const reveal = buildRevealSigned(internal, commit, c.txid, c.vout, c.value, to, MIN_POSTAGE);
  const revealTxid = (await api('/tx', { hex: reveal.toHex() })).txid;
  return { commitTxid: c.txid, revealTxid, inscriptionId: `${revealTxid}i0` };
}

// --- approvals: an approve.html window per request; connect grants persist ---
const approvalWaits = new Map();

function requestApproval(kind, origin, extra = {}) {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    approvalWaits.set(id, resolve);
    const q = new URLSearchParams({ id, kind, origin: origin || 'unknown', ...extra });
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/approve.html?' + q),
      type: 'popup', width: 380, height: kind === 'inscribe' ? 460 : 360,
    }).catch(() => { approvalWaits.delete(id); resolve(false); });
  });
}

async function ensureConnected(origin) {
  const { approvedOrigins = [] } = await chrome.storage.local.get('approvedOrigins');
  if (approvedOrigins.includes(origin)) return true;
  const ok = await requestApproval('connect', origin);
  if (ok) await chrome.storage.local.set({ approvedOrigins: [...approvedOrigins, origin] });
  return ok;
}

// --- message router (from content script / popup) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const { method, params } = msg;
      // trust the sender, not the page: extension pages are privileged
      const origin = sender.origin || (sender.tab && new URL(sender.tab.url).origin) || msg.origin || 'unknown';
      const trusted = origin.startsWith('chrome-extension://');
      if (method === 'approvalResult') {
        if (!trusted) return sendResponse({ error: 'forbidden' });
        const w = approvalWaits.get(params.id);
        if (w) { approvalWaits.delete(params.id); w(!!params.granted); }
        return sendResponse({ result: true });
      }
      if (method === 'connect') {
        const k = await getKey().catch(() => null);
        if (!k) return sendResponse({ result: null }); // no wallet yet — nothing to approve
        if (!trusted && !(await ensureConnected(origin))) return sendResponse({ error: 'User rejected the connection' });
        return sendResponse({ result: addressesFromKey(k) });
      }
      if (!trusted) { // every other dApp call requires a prior connect approval
        const { approvedOrigins = [] } = await chrome.storage.local.get('approvedOrigins');
        if (!approvedOrigins.includes(origin)) return sendResponse({ error: 'Not connected — call wattx.connect() first' });
      }
      if (method === 'getAccounts') { const k = await getKey(); return sendResponse({ result: addressesFromKey(k) }); }
      if (method === 'getBalance') { const k = await getKey(); const b = await api(`/address/${addressesFromKey(k).segwit}/balance`); return sendResponse({ result: b }); }
      if (method === 'inscribe') return sendResponse({ result: await doInscribe(params, origin) });
      // popup-only key management — never reachable from a web page
      if (method === 'createWallet' || method === 'importWallet' || method === 'exportBackup') {
        if (!trusted) return sendResponse({ error: 'forbidden' });
        if (method === 'exportBackup') {
          const { wifKey, mnemonic } = await chrome.storage.local.get(['wifKey', 'mnemonic']);
          if (!wifKey) return sendResponse({ error: 'No wallet yet' });
          return sendResponse({ result: { mnemonic: mnemonic || null, wif: wifKey } });
        }
        let k, mnemonic = null;
        if (method === 'createWallet') { mnemonic = newMnemonic(); k = keyFromMnemonic(mnemonic); }
        else if (params.mnemonic) { mnemonic = params.mnemonic.trim().toLowerCase().replace(/\s+/g, ' '); k = keyFromMnemonic(mnemonic); }
        else k = ECPair.fromWIF(params.wif, WATTX);
        await chrome.storage.local.set({ wifKey: k.toWIF(), ...(mnemonic ? { mnemonic } : {}) });
        if (!mnemonic) await chrome.storage.local.remove('mnemonic'); // a WIF import has no phrase
        return sendResponse({ result: { ...addressesFromKey(k), ...(mnemonic ? { mnemonic } : {}) } });
      }
      return sendResponse({ error: 'unknown method: ' + method });
    } catch (e) { sendResponse({ error: e.message }); }
  })();
  return true; // async
});
