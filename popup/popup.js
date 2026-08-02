const $ = (id) => document.getElementById(id);
const send = (method, params) => chrome.runtime.sendMessage({ method, params });

function showWallet(addr) {
  $('setup').classList.add('hide');
  $('wallet').classList.remove('hide');
  $('taproot').textContent = addr.taproot;
  $('segwit').textContent = addr.segwit;
  refreshBalance();
}
async function refreshBalance() {
  const r = await send('getBalance').catch(() => null);
  $('bal').textContent = (r && r.result != null)
    ? (Number(r.result.confirmed ?? r.result) / 1e8).toLocaleString() + ' WTX'
    : '— WTX (needs the WATTx UTXO API)';
}

async function init() {
  const r = await send('getAccounts').catch(() => null);
  if (r && r.result) showWallet(r.result);
}
$('create').onclick = async () => {
  const r = await send('createWallet');
  if (r.result) { showWallet(r.result); $('msg').textContent = 'Wallet created. Back up your key from Settings.'; }
  else $('msg').textContent = r.error || 'error';
};
$('import').onclick = async () => {
  const wif = $('wif').value.trim();
  if (!wif) return ($('msg').textContent = 'Paste a WIF key first');
  const r = await send('importWallet', { wif });
  if (r.result) showWallet(r.result); else $('msg').textContent = r.error || 'invalid key';
};
$('refresh').onclick = refreshBalance;
init();
