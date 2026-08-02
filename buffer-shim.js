import { Buffer as _Buffer } from 'buffer';
export const Buffer = _Buffer;
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = _Buffer;
