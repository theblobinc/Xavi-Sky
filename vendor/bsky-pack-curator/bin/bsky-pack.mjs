#!/usr/bin/env node
/**
 * bsky-pack CLI.
 *
 * Subcommands:
 *   new <slug>               — curate + render + save the pack roster
 *   rerun <slug>             — re-run last config, diff vs prior snapshot
 *   check-saturation <theme> — saturation scrape (needs Puppeteer)
 *   contacts <slug>          — print tiered amplification contact list for a saved pack
 *
 * The tool is read-only against Bluesky's public API. It produces a pasteable
 * roster + supporting outputs. To actually create the pack on your account,
 * follow the walkthrough at the top of the generated roster.md.
 *
 * Use --help on any subcommand for flags.
 */

import { mkdir, writeFile, readFile, access } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCuration } from '../src/pipeline.mjs';
import { renderRoster } from '../src/render/markdown.mjs';
import { renderMembersJson, renderFullDataset } from '../src/render/json.mjs';
import { renderRedditPost } from '../src/render/reddit.mjs';
import { renderContactMarkdown } from '../src/tools/contact-list.mjs';
import { scrapeSaturation, manualCheckUrls } from '../src/tools/saturation-scrape.mjs';
import { validateSlug, validateLimit, validateActivityDays } from '../src/util/validate.mjs';

// Anchor packs/ to the repo root, not the user's current working directory.
// Override with BSKY_PACKS_DIR env var if you want output somewhere else.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_ROOT = process.env.BSKY_PACKS_DIR
  ? resolve(process.env.BSKY_PACKS_DIR)
  : join(REPO_ROOT, 'packs');

function parseArgs(argv) {
  const args = { _: [], flags: {}, duplicates: [] };
  const seen = new Set();
  const setFlag = (key, value) => {
    if (seen.has(key)) args.duplicates.push(key);
    seen.add(key);
    args.flags[key] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eqIdx = a.indexOf('=');
      if (eqIdx !== -1) {
        setFlag(a.slice(2, eqIdx), a.slice(eqIdx + 1));
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        setFlag(key, true);
      } else {
        setFlag(key, next);
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  if (args.duplicates.length > 0) {
    const uniq = [...new Set(args.duplicates)];
    console.warn(
      `Warning: duplicate flag(s) seen, last value wins: ${uniq.map(d => '--' + d).join(', ')}`,
    );
  }
  return args;
}

async function packDirExists(slug) {
  try {
    await access(join(PACKS_ROOT, slug, 'dataset.json'));
    return true;
  } catch {
    return false;
  }
}

function asList(v) {
  if (!v || typeof v !== 'string') return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

async function cmdNew(args) {
  const slug = args._[1];
  if (!slug) failMissing('new', 'slug', 'bsky-pack new <slug> --queries "..." --bio-match "..."');
  try { validateSlug(slug); } catch (err) { fail(err.message); }
  const queries = asList(args.flags.queries);
  const bioMatch = asList(args.flags['bio-match'] || args.flags.queries);
  if (queries.length === 0) failMissing('new', '--queries', 'bsky-pack new substack-writers --queries "substack" --bio-match "substack"');
  if (bioMatch.length === 0) failMissing('new', '--bio-match', 'bsky-pack new substack-writers --queries "substack" --bio-match "substack"');

  let limit, activityDays;
  try {
    limit = validateLimit(args.flags.limit);
    activityDays = validateActivityDays(args.flags['activity-days']);
  } catch (err) {
    fail(err.message);
  }

  const opts = {
    name: args.flags.name || slug.replace(/-/g, ' '),
    description: args.flags.description || '',
    queries,
    bioMatch,
    limit,
    activityDays,
    viewerHandle: args.flags.viewer || null,
    packsDir: PACKS_ROOT,
    packDir: join(PACKS_ROOT, slug),
    checkSaturation: !!args.flags['check-saturation'],
    deepSaturation: !!args.flags['deep-saturation'],
  };

  const result = await runCuration(opts);
  await saveAll(slug, result);
  console.log(`\nDone. Output at packs/${slug}/`);
  console.log(`Next: open packs/${slug}/roster.md and follow the "How to create the pack on Bluesky" walkthrough.`);
}

async function cmdRerun(args) {
  const slug = args._[1];
  if (!slug) failMissing('rerun', 'slug', 'bsky-pack rerun substack-writers');
  try { validateSlug(slug); } catch (err) { fail(err.message); }
  if (!(await packDirExists(slug))) {
    fail(`No pack found at packs/${slug}/. Run \`bsky-pack new ${slug} ...\` first.`);
  }
  const dir = join(PACKS_ROOT, slug);
  const config = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
  const result = await runCuration({ ...config, packsDir: PACKS_ROOT, packDir: dir });
  await saveAll(slug, result);
  if (result.diff && !result.diff.isFirstRun) {
    console.log('\nDiff vs prior run:');
    console.log(`  + ${result.diff.addedCount} added`);
    console.log(`  - ${result.diff.droppedCount} dropped`);
    console.log(`  ↑ ${result.diff.grew.length} grew ≥ 2×`);
    console.log(`  ↓ ${result.diff.shrank.length} shrank > 30%`);
  }
}

async function cmdCheckSaturation(args) {
  const theme = args._.slice(1).join(' ');
  if (!theme) failMissing('check-saturation', 'theme', 'bsky-pack check-saturation "substack writers"');
  const result = await scrapeSaturation(theme);
  if (!result) {
    console.log('Puppeteer not installed. Manual-check URLs:');
    for (const u of manualCheckUrls(theme)) console.log(`  ${u}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function cmdContacts(args) {
  const slug = args._[1];
  if (!slug) failMissing('contacts', 'slug', 'bsky-pack contacts substack-writers');
  try { validateSlug(slug); } catch (err) { fail(err.message); }
  if (!(await packDirExists(slug))) {
    fail(`No pack found at packs/${slug}/. Run \`bsky-pack new ${slug} ...\` first.`);
  }
  const dir = join(PACKS_ROOT, slug);
  const dataset = JSON.parse(await readFile(join(dir, 'dataset.json'), 'utf8'));
  const { generateContactList } = await import('../src/tools/contact-list.mjs');
  const reshareScores = dataset.members.map(m => ({
    did: m.did,
    reshareProbability: m.scoreBreakdown?.reshareProbability || 0,
  }));
  const contacts = generateContactList(dataset.members, reshareScores);
  console.log(renderContactMarkdown(contacts));
}

async function saveAll(slug, result) {
  const dir = join(PACKS_ROOT, slug);
  await mkdir(dir, { recursive: true });

  if (result.meta.emptyResult || result.members.length === 0) {
    console.log(`No candidates matched. Skipping pack save. Try broader --queries or --bio-match.`);
    return;
  }

  const meta = { ...result.meta, slug };

  const markdown = renderRoster({
    pack: result.pack,
    members: result.members,
    contactList: result.contactList,
    reshareTop: result.reshareTop,
    saturationResult: result.saturationResult,
    diff: result.diff,
    meta,
  });
  await writeFile(join(dir, 'roster.md'), markdown, 'utf8');

  const membersJson = renderMembersJson({ pack: result.pack, members: result.members, meta });
  await writeFile(join(dir, 'members.json'), JSON.stringify(membersJson, null, 2), 'utf8');

  const dataset = renderFullDataset({
    pack: result.pack,
    members: result.members,
    meta,
    saturationResult: result.saturationResult,
    diff: result.diff,
  });
  await writeFile(join(dir, 'dataset.json'), JSON.stringify(dataset, null, 2), 'utf8');

  const reddit = renderRedditPost({ pack: result.pack, members: result.members, meta });
  await writeFile(join(dir, 'reddit-post.md'), reddit, 'utf8');

  const contacts = renderContactMarkdown(result.contactList);
  await writeFile(join(dir, 'contact-list.md'), contacts, 'utf8');

  const config = {
    name: result.pack.name,
    description: result.pack.description,
    queries: result.meta.queries,
    bioMatch: result.meta.bioMatch,
    limit: result.members.length,
    activityDays: result.meta.activityDays,
    viewerHandle: result.meta.networkAugmented,
  };
  await writeFile(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function failMissing(sub, what, example) {
  console.error(`Error: \`${sub}\` requires ${what}.\n`);
  console.error(`Example:\n  ${example}\n`);
  console.error(`Run \`bsky-pack help ${sub}\` for full options.`);
  process.exit(1);
}

function usage() {
  const generic = `
bsky-pack — curate Bluesky starter packs from the public API

Quickstart:
  node bin/bsky-pack.mjs new substack-writers \\
    --queries "substack" --bio-match "substack"

Subcommands:
  new <slug>              Curate a pack: search, filter, score, render to packs/<slug>/
  rerun <slug>            Re-run last config; output diff vs prior snapshot.
  check-saturation "..."  Scrape DuckDuckGo for competing packs (needs Puppeteer).
  contacts <slug>         Print tiered amplification contact list for a saved pack.

Common flags for \`new\`:
  --queries "a,b"         Comma-separated search queries (required)
  --bio-match "x,y"       Comma-separated bio-substring patterns (required)
  --name "..."            Pack name (default: slug)
  --description "..."     Pack description
  --limit 150             Max members (default 150, Bluesky cap)
  --activity-days 30      Drop accounts with no posts in last N days (0 to disable)
  --viewer handle.bsky    Augment with your social graph (boosts mutuals/follows)
  --check-saturation      Scrape DDG/Google for competing packs

Output per pack goes to packs/<slug>/:
  roster.md / members.json / dataset.json / reddit-post.md / contact-list.md / config.json

The roster.md includes a walkthrough for creating the pack manually on bsky.app.
This tool is read-only — it does not write to your Bluesky account.

Full examples: see examples/README.md
Docs: see README.md
`;
  console.error(generic.trim());
  process.exit(1);
}

function helpForSubcommand(sub) {
  const per = {
    new: `
bsky-pack new <slug> [options]

  Required:
    <slug>               directory name under packs/ (e.g. substack-writers)
    --queries "a,b"      comma-separated search queries
    --bio-match "x,y"    comma-separated bio-substring patterns

  Optional:
    --name "..."             pack name (default: slug)
    --description "..."      pack description (≤ 300 chars)
    --limit N                top-N members (default 150)
    --activity-days N        drop dormant accounts (default 30, 0 to disable)
    --viewer handle.bsky     network-graph augmentation
    --check-saturation       scrape competing packs (needs Puppeteer)
    --deep-saturation        also scrape member lists of competing packs

  Example:
    bsky-pack new indie-scholars \\
      --queries "independent scholar,indie researcher" \\
      --bio-match "independent scholar,indie researcher" \\
      --viewer yourhandle.bsky.social
`,
    rerun: `
bsky-pack rerun <slug>

  Re-runs the last saved config for <slug> and outputs a diff vs the prior
  members.json snapshot (added, dropped, grew 2×, shrank 30%+).
`,
    'check-saturation': `
bsky-pack check-saturation "<theme>"

  Scrapes DuckDuckGo (then Google) for existing packs in the theme.
  Requires Puppeteer:
    npm install puppeteer
`,
    contacts: `
bsky-pack contacts <slug>

  Prints the tiered amplification contact list for a saved pack.
`,
  };
  console.error((per[sub] || `Unknown subcommand: ${sub}`).trim());
  process.exit(per[sub] ? 0 : 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];

  if (args.flags.help || args.flags.h || sub === '--help' || sub === '-h') {
    usage();
    return;
  }
  if (sub === 'help') {
    if (args._[1]) return helpForSubcommand(args._[1]);
    return usage();
  }

  try {
    switch (sub) {
      case 'new': await cmdNew(args); break;
      case 'rerun': await cmdRerun(args); break;
      case 'check-saturation': await cmdCheckSaturation(args); break;
      case 'contacts': await cmdContacts(args); break;
      default: usage();
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exitCode = 1;
  }
}

main();
