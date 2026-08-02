# WATTx Wallet — browser extension

The Xverse/Unisat of WATTx: a self-custody browser wallet that holds WTX,
**inscribes ordinals**, and injects a `window.wattx` provider so dApps (the NFT
marketplace) can connect and mint ordinals directly — the true "connect wallet
→ inscribe" experience Xverse gives on Bitcoin, but for WATTx.

## Architecture

```
 dApp page ──window.wattx──▶ inpage.js ──postMessage──▶ content.js
                                                            │ chrome.runtime
                                                            ▼
                                                     background.js  (service worker)
                                                      · holds the key (self-custody)
                                                      · derives wx1 taproot + segwit addrs
                                                      · builds/signs commit+reveal (bitcoinjs)
                                                      · reads UTXOs / broadcasts via UTXO_API
                                popup/ ── create · import · balance · addresses
```

- **Client-side crypto** (`src/wattx.js`) — WATTx params (`wx` hrp, prefixes),
  taproot address derivation, and the ord commit/reveal inscription logic
  (same as the proven `wattx-ord` CLI). The private key never leaves the extension.
- **`window.wattx` provider** — `connect()`, `getAccounts()`, `getBalance()`,
  `inscribe({contentType,dataBase64,toAddress})`, `sendWTX()`, `signPsbt()`.

## The one backend piece it needs

A browser wallet can't reach a UTXO node directly. It needs a public **WATTx
UTXO/ordinals indexer API** (`UTXO_API` in `background.js`) exposing:
- `GET /address/:addr/utxo` → the address's spendable UTXOs
- `GET /address/:addr/balance` → confirmed/unconfirmed balance
- `POST /tx {hex}` → broadcast, returns `{txid}`

This is a Blockbook/Esplora-style service over `wattxd` (or a thin custom API
around `listunspent`/`sendrawtransaction`). It's the same indexer an explorer
uses. **Standing this up is the next step** — until then the wallet can create
keys and build inscriptions but can't fetch UTXOs or broadcast on its own.

## Build & load

```bash
npm install
npm run build         # bundles src/* → dist/ (bitcoinjs included)
# Chrome → Extensions → Developer mode → Load unpacked → this folder
```

## Status
- ✅ MV3 skeleton, provider API, page↔background bridge, popup (create/import/balance)
- ✅ WATTx params + taproot derivation + commit/reveal inscription (proven live via `wattx-ord`)
- ⏳ UTXO_API backend (deploy) · approval popups for connect/inscribe · encrypted key-at-rest · PSBT-sign UI · icons
