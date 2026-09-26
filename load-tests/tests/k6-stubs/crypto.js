import { createHash } from 'node:crypto';
export default { sha256: (input) => createHash('sha256').update(input).digest('hex') };
