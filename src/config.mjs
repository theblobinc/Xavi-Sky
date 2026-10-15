import os from 'node:os';
import { num } from './lib.mjs';

export const ROOT = new URL('../', import.meta.url).pathname;
export const DATA_DIR = process.env.XAVI_SKY_DATA_DIR || `${ROOT}data`;
export const SEED_PACKS_FILE = process.env.XAVI_SKY_SEED_PACKS_FILE || `${ROOT}seed-packs.txt`;
export const THEMES = (process.env.XAVI_SKY_THEMES || 'artificial intelligence|cybersecurity|open source|technology|canada|british columbia')
  .split('|').map(s => s.trim()).filter(Boolean);
export const MAX_CANDIDATES = num('MAX_CANDIDATES', 6000, 100, 30000);
export const PACKS_PER_THEME = num('PACKS_PER_THEME', 6, 1, 20);
export const RUN_DEADLINE_MS = num('RUN_DEADLINE_MS', 240000, 30000, 285000);
export const NODE_ID = (process.env.XAVI_SKY_NODE_ID || os.hostname() || 'xavi-sky-node').trim();
export const NODE_KIND = (process.env.XAVI_SKY_NODE_KIND || 'server').trim();
