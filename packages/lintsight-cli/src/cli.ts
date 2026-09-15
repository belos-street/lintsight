import pkg from '../package.json';
import { runPipeline } from './pipeline';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(`lintsight v${pkg.version}`);
  process.exit(0);
}

const usage = `lintsight v${pkg.version} — usage: lintsight <paths...> [--config <.oxlintrc>] [--version]`;

if (args.includes('--help') || args.includes('-h')) {
  console.log(usage);
  process.exit(0);
}

const configIdx = args.indexOf('--config');
const config = configIdx >= 0 ? args[configIdx + 1] : undefined;
const paths = args.filter(
  (a, i) => !a.startsWith('-') && !(configIdx >= 0 && i === configIdx + 1),
);

if (paths.length === 0) {
  console.error(usage);
  process.exit(2);
}

const result = await runPipeline(paths, { config });
if (result.error) console.error(`lintsight: ${result.error}`);
if (result.report) console.log(JSON.stringify(result.report, null, 2));
process.exit(result.exitCode);
