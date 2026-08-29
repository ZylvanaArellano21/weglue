import { loadConfig, parseArgs } from './config.js';
import { seed, teardown } from './seed.js';
import { signupBurst } from './signup-burst.js';
import { emailReliability } from './email-reliability.js';
import { concurrentActive } from './concurrent-active.js';
import { photoFanout } from './photo-fanout.js';
import { idempotency } from './idempotency.js';
import { report } from './report.js';

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === 'report') { report(rest); return; }
  if (!command) throw new Error('Usage: node dist/cli.js <seed|teardown|signup-burst|email-reliability|concurrent-active|photo-fanout|idempotency|report>');
  const config = loadConfig();
  const args = parseArgs(rest);
  let output: string | undefined;
  if (command === 'seed') output = await seed(config, args);
  else if (command === 'teardown') { await teardown(config, args); output = 'teardown complete'; }
  else if (command === 'signup-burst') output = await signupBurst(config, args);
  else if (command === 'email-reliability') output = await emailReliability(config, args);
  else if (command === 'concurrent-active') output = await concurrentActive(config, args);
  else if (command === 'photo-fanout') output = await photoFanout(config, args);
  else if (command === 'idempotency') output = await idempotency(config, args);
  else throw new Error(`Unknown command: ${command}`);
  if (output) console.log(output);
}

main()
  .then(() => { process.exit(0); })
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
