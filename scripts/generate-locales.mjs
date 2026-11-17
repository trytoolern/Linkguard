import { mkdir, writeFile } from 'node:fs/promises';
import { languages, translate } from '../lib/i18n.ts';
const source = {
  extensionDescription: 'Check links on the current page. Find, highlight and export broken links.',
  actionTitle: 'LinkGuard — check page links',
};
for (const { code } of languages) {
  const directory = new URL(`../public/_locales/${code.replaceAll('-', '_')}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  const messages = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, { message: translate(code, value) }]));
  await writeFile(new URL('messages.json', directory), JSON.stringify(messages, null, 2) + '\n');
}
