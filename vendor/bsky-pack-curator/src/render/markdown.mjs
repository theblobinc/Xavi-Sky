/**
 * Roster markdown renderer. Output matches the format we ship to humans —
 * pack name + description, create-in-UI walkthrough, ranked table with rationale,
 * amplification choreography, contact list section, methodology footer.
 */

import { BSKY_MAX_PACK_MEMBERS } from '../config.mjs';

/**
 * Sanitize a string for use inside a markdown table cell.
 * Strips/escapes characters that would break table formatting OR inject
 * unintended markdown when a member's display name contains backticks,
 * square brackets (link syntax), pipes, newlines, or HTML angle brackets.
 */
const sanitizeForTable = (s) => (s || '')
  .replace(/\|/g, '/')
  .replace(/\n+/g, ' ')
  .replace(/`/g, "'")          // backticks -> apostrophes (inline-code break)
  .replace(/[\[\]]/g, '')      // strip [ and ] (link syntax)
  .replace(/[<>]/g, '')        // strip < and > (raw HTML)
  .replace(/\s+/g, ' ')
  .slice(0, 200)
  .trim();

export function renderRoster({
  pack,
  members,
  contactList,
  reshareTop,
  saturationResult,
  diff,
  meta,
}) {
  const lines = [];
  lines.push(`# Starter Pack — ${pack.name}`);
  lines.push('');
  lines.push(`**Built:** ${meta.builtAt}`);
  lines.push(`**Pack name (≤ 50 chars):** \`${pack.name}\``);
  lines.push(`**Pack description (≤ 300 chars):**`);
  lines.push('');
  lines.push(`> ${pack.description}`);
  lines.push('');
  // Method
  lines.push('## Method');
  lines.push('');
  lines.push(`- Queries: ${meta.queries.map(q => `\`${q}\``).join(', ')}`);
  lines.push(`- Bio match: ${meta.bioMatch.map(p => `\`${p}\``).join(', ')}`);
  lines.push(`- Candidates fetched: ${meta.fetchedCount}`);
  lines.push(`- Bio matches: ${meta.bioMatchCount}`);
  lines.push(`- After activity filter (last ${meta.activityDays}d): ${meta.afterActivityCount}`);
  lines.push(`- Final selection: ${members.length} (cap ${BSKY_MAX_PACK_MEMBERS})`);
  if (meta.networkAugmented) lines.push(`- Network-graph augmented for viewer: @${meta.networkAugmented}`);
  lines.push('');

  // Diff section
  if (diff && !diff.isFirstRun) {
    lines.push('## Diff vs prior run');
    lines.push('');
    lines.push(`- Added: ${diff.addedCount}`);
    lines.push(`- Dropped: ${diff.droppedCount} (inactive, deleted, or lost bio match)`);
    lines.push(`- Grew ≥ 2×: ${diff.grew.length}`);
    lines.push(`- Shrank ≥ 30%: ${diff.shrank.length}`);
    lines.push('');
  }

  // Saturation
  if (saturationResult) {
    lines.push('## Saturation check');
    lines.push('');
    if (saturationResult.manualCheckUrls) {
      lines.push('Could not run automated saturation check (Puppeteer not installed).');
      lines.push('Verify competition manually via these URLs:');
      lines.push('');
      for (const u of saturationResult.manualCheckUrls) lines.push(`- ${u}`);
    } else if (saturationResult.captcha) {
      lines.push('Saturation check blocked by CAPTCHA from the search source. Try again later or check manually.');
    } else if (saturationResult.packs && saturationResult.packs.length > 0) {
      lines.push(`Found ${saturationResult.packs.length} existing pack(s) in this theme (via ${saturationResult.source}):`);
      lines.push('');
      for (const p of saturationResult.packs.slice(0, 8)) {
        const label = sanitizeForTable(p.textSnippet || p.url).slice(0, 80);
        lines.push(`- [${label}](${p.url})`);
      }
    } else {
      lines.push(`No competing packs found via ${saturationResult.source || 'search'}. Strong differentiation, OR a sign the theme is too narrow for established curators.`);
    }
    lines.push('');
  }

  // How to create the pack on Bluesky
  lines.push('## How to create the pack on Bluesky');
  lines.push('');
  lines.push('1. Go to your profile on bsky.app and click **Starter Packs** → **Create a starter pack**.');
  lines.push('2. Paste the pack name and description from the top of this file.');
  lines.push('3. Copy each handle from the roster below into the pack-builder search box, one at a time, and tap to add.');
  lines.push('4. Save → share the resulting URL.');
  lines.push('');
  lines.push('Order matters less than completeness — the UI shows a running count out of 150.');
  lines.push('');

  // Roster table
  lines.push(`## Roster (${members.length} accounts)`);
  lines.push('');
  lines.push('| Rank | Handle | Display name | Followers | Why included |');
  lines.push('|---:|---|---|---:|---|');
  members.forEach((m, i) => {
    lines.push(
      `| ${i + 1} | ${sanitizeForTable(m.handle)} | ${sanitizeForTable(m.displayName)} | ${(m.followersCount || 0).toLocaleString()} | ${sanitizeForTable(m.rationale)} |`,
    );
  });
  lines.push('');

  // Reshare top
  if (reshareTop && reshareTop.length > 0) {
    lines.push('## Top reshare-likelihood candidates');
    lines.push('');
    lines.push('Smaller niche-matched accounts with high activity — most likely to amplify on inclusion.');
    lines.push('');
    for (const m of reshareTop.slice(0, 10)) {
      lines.push(`- @${m.handle} — ${m.displayName} (${(m.followersCount || 0).toLocaleString()} followers)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
