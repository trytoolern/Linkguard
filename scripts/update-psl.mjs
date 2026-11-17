// Refresh the bundled public suffix data from the authoritative source.
import { readFile, writeFile } from 'node:fs/promises';
const address = 'https://publicsuffix.org/list/public_suffix_list.dat';
const response = process.argv[2] ? undefined : await fetch(address, { signal: AbortSignal.timeout(15000) });
if (response && !response.ok) throw new Error(`PSL download failed: ${response.status}`);
const text = response ? await response.text() : await readFile(process.argv[2], 'utf8');
if (!text.includes('===BEGIN ICANN DOMAINS===') || !text.includes('===BEGIN PRIVATE DOMAINS===')) throw new Error('Incomplete PSL file');
const rules = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//'));
if (rules.length < 5000 || rules.length > 100000 || rules.some(line => /[\s`]/.test(line))) throw new Error('Invalid PSL rules');
const version = /^\/\/ VERSION: (.+)$/m.exec(text)?.[1] ?? `downloaded ${new Date().toISOString().slice(0, 10)}`;
await writeFile(new URL('../lib/psl-rules.ts', import.meta.url), `// Public Suffix List, MPL-2.0. ${address}\n// ${version}\n// Includes ICANN and PRIVATE sections. See licenses/PSL-MPL-2.0.txt.\nexport const pslRules = ${JSON.stringify(rules.join('\n'))};\n`);
console.log(`Updated ${rules.length} public suffix rules (${version}). Run npm test and npm run build.`);
