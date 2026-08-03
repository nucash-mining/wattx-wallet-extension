const $ = (id) => document.getElementById(id);
const send = (method, params) => chrome.runtime.sendMessage({ method, params });

function renderWords(el, mnemonic) {
  el.innerHTML = mnemonic.split(' ').map((w, i) => `<span><i>${i + 1}</i>${w}</span>`).join('');
}

function showWallet(addr) {
  $('setup').classList.add('hide');
  $('seedbox').classList.add('hide');
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

let pendingAddr = null;
$('create').onclick = async () => {
  const r = await send('createWallet');
  if (!r.result) return ($('msg').textContent = r.error || 'error');
  // force the seed-phrase step before showing the wallet
  pendingAddr = r.result;
  renderWords($('words'), r.result.mnemonic);
  $('setup').classList.add('hide');
  $('seedbox').classList.remove('hide');
};
$('seedok').onclick = () => { if (pendingAddr) showWallet(pendingAddr); pendingAddr = null; };

$('import').onclick = async () => {
  const v = $('wif').value.trim();
  if (!v) return ($('msg').textContent = 'Paste a seed phrase or WIF key first');
  const params = v.includes(' ') ? { mnemonic: v } : { wif: v };
  const r = await send('importWallet', params);
  if (r.result) showWallet(r.result);
  else $('msg').textContent = r.error || 'invalid seed phrase / key';
};

$('backupBtn').onclick = async () => {
  const open = !$('backup').classList.contains('hide');
  if (open) { $('backup').classList.add('hide'); $('backupBtn').textContent = 'Backup wallet'; return; }
  const r = await send('exportBackup').catch(() => null);
  if (!r || !r.result) return ($('msg').textContent = (r && r.error) || 'error');
  if (r.result.mnemonic) {
    $('backupLbl').textContent = 'Recovery phrase';
    renderWords($('backupWords'), r.result.mnemonic);
    $('backupWords').classList.remove('hide');
    $('backupWif').classList.add('hide');
  } else {
    // legacy wallet created before seed phrases: the WIF key IS the backup
    $('backupLbl').textContent = 'Private key (WIF) — this wallet predates seed phrases';
    $('backupWords').innerHTML = '';
    $('backupWif').textContent = r.result.wif;
    $('backupWif').classList.remove('hide');
  }
  $('backup').classList.remove('hide');
  $('backupBtn').textContent = 'Hide backup';
};

$('refresh').onclick = refreshBalance;
init();
