// Shared WATTx chain params + ordinal inscription logic for the extension.
// (Same params as the wattx-ord CLI; bundled into the service worker.)
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from '@bitcoinerlab/secp256k1';

bitcoin.initEccLib(ecc);
export const ECPair = ECPairFactory(ecc);

export const WATTX = {
  messagePrefix: '\x18WATTx Signed Message:\n',
  bech32: 'wx',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 73,
  scriptHash: 75,
  wif: 128,
};

// WATTx fee reality (Qtum 0.004 WTX/kB ≈ 400 sat/vbyte — far above Bitcoin's 1).
export const WATTX_MIN_FEERATE = 500;      // sat/vbyte
export const WATTX_MIN_FEE = 100000;       // sat floor
export const MIN_POSTAGE = 1000000;        // 0.01 WTX — clears WATTx dust
export const RPC = 'https://rpc-wtx.wattxchange.app'; // EVM read RPC (balance via janus)

export const toXOnly = (pub) => (pub.length === 32 ? pub : pub.slice(1, 33));

// Derive a taproot (wx1p) receive address + a legacy (W...) address from a key.
export function addressesFromKey(keyPair) {
  const p2tr = bitcoin.payments.p2tr({ internalPubkey: toXOnly(keyPair.publicKey), network: WATTX });
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: WATTX });
  const p2pkh = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: WATTX });
  return { taproot: p2tr.address, segwit: p2wpkh.address, legacy: p2pkh.address };
}

// The ord inscription envelope leaf script.
export function buildInscriptionScript(xOnlyPubkey, contentType, data) {
  const chunks = [];
  for (let i = 0; i < data.length; i += 520) chunks.push(data.subarray(i, i + 520));
  return bitcoin.script.compile([
    xOnlyPubkey, bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_FALSE, bitcoin.opcodes.OP_IF,
    Buffer.from('ord'), Buffer.from([0x01]), Buffer.from(contentType, 'utf8'), Buffer.from([0x00]),
    ...chunks, bitcoin.opcodes.OP_ENDIF,
  ]);
}

export function estRevealVsize(leafLen){ return 68 + Math.ceil((leafLen + 130) / 4); }

// Prepare the commit taproot output committing to the inscription of `data`.
export function prepareCommit(internalKey, contentType, data) {
  const xOnly = toXOnly(internalKey.publicKey);
  const leafScript = buildInscriptionScript(xOnly, contentType, data);
  const redeem = { output: leafScript, redeemVersion: 0xc0 };
  const p2tr = bitcoin.payments.p2tr({ internalPubkey: xOnly, scriptTree: { output: leafScript }, redeem, network: WATTX });
  return { address: p2tr.address, output: p2tr.output, leafScript, controlBlock: p2tr.witness[p2tr.witness.length - 1] };
}

// Sign the reveal spending the commit UTXO via the script path.
export function buildRevealSigned(internalKey, commit, commitTxid, commitVout, commitValue, to, postage, feeRate = WATTX_MIN_FEERATE) {
  const psbt = new bitcoin.Psbt({ network: WATTX });
  psbt.addInput({
    hash: commitTxid, index: commitVout,
    witnessUtxo: { script: commit.output, value: commitValue },
    tapLeafScript: [{ leafVersion: 0xc0, script: commit.leafScript, controlBlock: commit.controlBlock }],
  });
  const fee = Math.max(estRevealVsize(commit.leafScript.length) * feeRate, WATTX_MIN_FEE);
  psbt.addOutput({ address: to, value: Math.max(commitValue - fee, postage) });
  psbt.signInput(0, {
    publicKey: internalKey.publicKey,
    signSchnorr: (h) => Buffer.from(ecc.signSchnorr(h, internalKey.privateKey)),
  });
  psbt.finalizeInput(0);
  return psbt.extractTransaction();
}
