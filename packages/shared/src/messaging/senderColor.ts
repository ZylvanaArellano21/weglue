/**
 * Deterministic colour for a sender's display name in a group thread, shared by
 * mobile and web so the same person is the same colour on both platforms.
 * Never used for the viewer's own messages.
 */
const SENDER_NAME_PALETTE = [
  '#0A8080',
  '#B4690E',
  '#7A3E9D',
  '#1E6F50',
  '#B23A48',
  '#2A5DAA',
  '#8A6D1F',
  '#3E7C4A',
];

export function senderNameColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return SENDER_NAME_PALETTE[Math.abs(h) % SENDER_NAME_PALETTE.length]!;
}
