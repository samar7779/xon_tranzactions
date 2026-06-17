// i18n fragment merger.
// Reads a fragment JSON of shape { "<namespace>": { "<key>": { "uz": "...", "ru": "...", "en": "..." } } }
// and deep-merges it into messages/{uz,ru,en}.json (creating namespaces/keys as needed).
// Usage: node scripts/i18n-merge.mjs <fragment.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MSG_DIR = join(__dirname, '..', 'i18n', 'messages');
const LANGS = ['uz', 'ru', 'en'];

const fragPath = process.argv[2];
if (!fragPath) {
  console.error('Usage: node scripts/i18n-merge.mjs <fragment.json>');
  process.exit(1);
}

const fragment = JSON.parse(readFileSync(fragPath, 'utf8'));

const stats = { added: 0, overwritten: 0, skippedMissingLang: 0 };

for (const lang of LANGS) {
  const file = join(MSG_DIR, `${lang}.json`);
  const data = JSON.parse(readFileSync(file, 'utf8'));

  for (const [ns, keys] of Object.entries(fragment)) {
    if (!data[ns] || typeof data[ns] !== 'object') data[ns] = {};
    for (const [key, vals] of Object.entries(keys)) {
      if (typeof vals !== 'object' || vals === null) {
        console.warn(`! ${ns}.${key}: value is not an object, skipping`);
        continue;
      }
      const v = vals[lang];
      if (v === undefined || v === null) {
        stats.skippedMissingLang++;
        continue;
      }
      if (key in data[ns]) stats.overwritten++;
      else stats.added++;
      data[ns][key] = v;
    }
  }

  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✓ merged into ${lang}.json`);
}

console.log(`Done. added=${Math.round(stats.added / LANGS.length)} overwritten=${Math.round(stats.overwritten / LANGS.length)} missingLang=${stats.skippedMissingLang}`);
