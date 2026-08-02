// Background service worker — holds the key, derives addresses, signs, and
// orchestrates ordinal inscription. Self-custody: the private key never leaves
// the extension. Reads UTXOs and broadcasts via a WATTx UTXO API (see UTXO_API).
import { ECPair, WATTX, addressesFromKey, prepareCommit, buildRevealSigned,
         MIN_POSTAGE, WATTX_MIN_FEERATE, WATTX_MIN_FEE, estRevealVsize, toXOnly } from './wattx.js';
import * as bitcoin from 'bitcoinjs-lib';

// WATTx UTXO/ordinals indexer API (address UTXOs + broadcast). This backend is
// the one piece that must be stood up publicly (Blockbook/Esplora-style over
// wattxd) for the wallet to work without the user running a node.
const UTXO_API = 'https://ord-api.wattxchange.app'; // TODO: deploy this

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

async function doInscribe({ contentType, dataBase64, toAddress }) {
  const keyPair = await getKey();
  const to = toAddress || addressesFromKey(keyPair).taproot;
  const data = Buffer.from(dataBase64, 'base64');
  const internal = ECPair.makeRandom({ network: WATTX });
  const commit = prepareCommit(internal, contentType, data);
  const revealFee = Math.max(estRevealVsize(commit.leafScript.length) * WATTX_MIN_FEERATE, WATTX_MIN_FEE);
  const fund = MIN_POSTAGE + revealFee + 10000;

  const c = await fundCommit(keyPair, commit.address, fund);
  const reveal = buildRevealSigned(internal, commit, c.txid, c.vout, c.value, to, MIN_POSTAGE);
  const revealTxid = (await api('/tx', { hex: reveal.toHex() })).txid;
  return { commitTxid: c.txid, revealTxid, inscriptionId: `${revealTxid}i0` };
}

// --- message router (from content script / popup) ---
const approvedOrigins = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const { method, params } = msg;
      if (method === 'connect') {
        // TODO: open an approval popup; auto-approve for now
        approvedOrigins.add(msg.origin);
        const k = await getKey().catch(() => null);
        return sendResponse({ result: k ? addressesFromKey(k) : null });
      }
      if (method === 'getAccounts') { const k = await getKey(); return sendResponse({ result: addressesFromKey(k) }); }
      if (method === 'getBalance') { const k = await getKey(); const b = await api(`/address/${addressesFromKey(k).segwit}/balance`); return sendResponse({ result: b }); }
      if (method === 'inscribe') return sendResponse({ result: await doInscribe(params) });
      // popup-only key management
      if (method === 'createWallet') { const k = ECPair.makeRandom({ network: WATTX }); await setKey(k); return sendResponse({ result: addressesFromKey(k) }); }
      if (method === 'importWallet') { const k = ECPair.fromWIF(params.wif, WATTX); await setKey(k); return sendResponse({ result: addressesFromKey(k) }); }
      return sendResponse({ error: 'unknown method: ' + method });
    } catch (e) { sendResponse({ error: e.message }); }
  })();
  return true; // async
});
