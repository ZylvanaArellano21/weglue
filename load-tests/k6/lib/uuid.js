// Shared by the Node control plane (src/synthetic.ts) and the k6 script, so
// seed-time and run-time identifiers use exactly one derivation.

/** RFC 4122 variant, version-5-shaped UUID from a SHA-256 hex digest. */
export function uuidFromSha256Hex(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Expected a SHA-256 hex digest');
  const chars = hex.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
