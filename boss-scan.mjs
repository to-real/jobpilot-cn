#!/usr/bin/env node

/**
 * Boss Zhipin scanner.
 *
 * Public search is the default. Chrome login mode is available only when the
 * caller passes both --use-chrome and --i-understand-login-risk.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import {
  connectToChrome,
  createPublicBrowser,
  loginRiskWarning,
} from './lib/web-access-lite.mjs';

const PORTALS_PATH = 'portals.yml';
const PROFILE_PATH = 'config/profile.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

const DEFAULT_BOSS_CONFIG = {
  enabled: false,
  access_mode: 'public_first',
  keywords_from_profile: true,
  keywords: [],
  cities: [{ name: 'Shanghai', code: '101020100' }],
  max_pages: 1,
  rate_limit_ms: 2500,
};

const CITY_CODES = new Map([
  ['beijing', '101010100'],
  ['北京', '101010100'],
  ['shanghai', '101020100'],
  ['上海', '101020100'],
  ['guangzhou', '101280100'],
  ['广州', '101280100'],
  ['shenzhen', '101280600'],
  ['深圳', '101280600'],
  ['hangzhou', '101210100'],
  ['杭州', '101210100'],
  ['chengdu', '101270100'],
  ['成都', '101270100'],
]);

function parseArgs(argv) {
  const args = new Set(argv);
  const positional = argv.filter((arg) => !arg.startsWith('-'));
  const valueOf = (flag) => {
    const idx = argv.indexOf(flag);
    return idx === -1 ? null : argv[idx + 1] || null;
  };
  const envFlag = (name) => process.env[name] === 'true' || process.env[name] === '1';
  const envValue = (name) => process.env[name] || null;

  return {
    dryRun: args.has('--dry-run') || envFlag('npm_config_dry_run'),
    useChrome: args.has('--use-chrome') || envFlag('npm_config_use_chrome'),
    riskAccepted: args.has('--i-understand-login-risk') || envFlag('npm_config_i_understand_login_risk'),
    query: valueOf('--query') || positional[0] || envValue('npm_config_query') || null,
    city: valueOf('--city') || positional[1] || envValue('npm_config_city') || null,
    maxPages: valueOf('--max-pages') || positional[2] || envValue('npm_config_max_pages') || null,
  };
}

function readYamlIfExists(filePath) {
  if (!existsSync(filePath)) return {};
  return yaml.load(readFileSync(filePath, 'utf-8')) || {};
}

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function loadBossConfig() {
  const portals = readYamlIfExists(PORTALS_PATH);
  return {
    ...DEFAULT_BOSS_CONFIG,
    ...(portals.boss_zhipin || {}),
  };
}

function deriveKeywords(config, profile, portals, queryOverride) {
  if (queryOverride) return [queryOverride];

  const explicit = normalizeList(config.keywords);
  const fromProfile = [];

  if (config.keywords_from_profile !== false) {
    fromProfile.push(...normalizeList(profile.target_roles?.primary));
    for (const archetype of normalizeList(profile.target_roles?.archetypes)) {
      if (typeof archetype === 'string') {
        fromProfile.push(archetype);
      } else if (archetype?.name) {
        fromProfile.push(archetype.name);
      }
    }
  }

  const fromTitleFilter = normalizeList(portals.title_filter?.positive);
  const keywords = [...explicit, ...fromProfile, ...fromTitleFilter]
    .map((keyword) => String(keyword).trim())
    .filter(Boolean);

  return [...new Set(keywords)].slice(0, 8);
}

function deriveCities(config, profile, cityOverride) {
  if (cityOverride) {
    const code = CITY_CODES.get(cityOverride.toLowerCase()) || CITY_CODES.get(cityOverride) || cityOverride;
    return [{ name: cityOverride, code }];
  }

  const configured = normalizeList(config.cities)
    .map((city) => {
      if (typeof city === 'string') {
        return { name: city, code: CITY_CODES.get(city.toLowerCase()) || CITY_CODES.get(city) || city };
      }
      return city;
    })
    .filter((city) => city?.code);

  if (configured.length > 0) return configured;

  const profileCity = profile.location?.city || profile.candidate?.location;
  if (profileCity) {
    const lower = String(profileCity).toLowerCase();
    for (const [name, code] of CITY_CODES) {
      if (lower.includes(name.toLowerCase())) {
        return [{ name: profileCity, code }];
      }
    }
  }

  return DEFAULT_BOSS_CONFIG.cities;
}

function buildSearchUrl({ keyword, cityCode, page }) {
  const url = new URL('https://www.zhipin.com/web/geek/job');
  url.searchParams.set('query', keyword);
  url.searchParams.set('city', cityCode);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTitleFilter(titleFilter) {
  const positive = normalizeList(titleFilter?.positive).map((keyword) => keyword.toLowerCase());
  const negative = normalizeList(titleFilter?.negative).map((keyword) => keyword.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some((keyword) => lower.includes(keyword));
    const hasNegative = negative.some((keyword) => lower.includes(keyword));
    return hasPositive && !hasNegative;
  };
}

function loadSeenUrls() {
  const seen = new Set();

  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (!existsSync(APPLICATIONS_PATH)) return seen;

  const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
  for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
    const company = match[1].trim().toLowerCase();
    const role = match[2].trim().toLowerCase();
    if (company && role && company !== 'company') {
      seen.add(`${company}::${role}`);
    }
  }

  return seen;
}

function ensurePipelineExists() {
  mkdirSync('data', { recursive: true });
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, '# Pipeline\n\n## Pendientes\n\n## Procesadas\n', 'utf-8');
  }
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  ensurePipelineExists();

  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  const block = '\n' + offers
    .map((offer) => `- [ ] ${offer.url} | ${offer.company} | ${offer.title}`)
    .join('\n') + '\n';

  if (idx === -1) {
    text += `\n${marker}\n${block}`;
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(rows, date) {
  mkdirSync('data', { recursive: true });
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = rows.map((row) => [
    row.url,
    date,
    row.source || 'boss-zhipin',
    row.title,
    row.company,
    row.status,
  ].join('\t')).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

async function extractBossJobs(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const blockerPatterns = [
      '登录后继续',
      '安全验证',
      '验证码',
      '请先登录',
      '访问异常',
      '系统检测到',
    ];
    const blocked = blockerPatterns.some((pattern) => text.includes(pattern));

    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const absolutize = (href) => {
      if (!href) return '';
      try {
        return new URL(href, location.href).toString();
      } catch {
        return '';
      }
    };

    const cardSelectors = [
      '.job-card-wrapper',
      '.job-list-box li',
      '.job-card-left',
      '[class*="job-card"]',
    ];

    const cards = [...new Set(cardSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
    const jobs = [];

    for (const card of cards) {
      const link = card.querySelector('a[href*="/job_detail/"]') || card.closest('a[href*="/job_detail/"]');
      const titleEl = card.querySelector('.job-name, .job-title, [class*="job-name"], [class*="job-title"]') || link;
      const companyEl = card.querySelector('.company-name, [class*="company-name"]');
      const salaryEl = card.querySelector('.salary, [class*="salary"]');
      const locationEl = card.querySelector('.job-area, .job-location, [class*="job-area"], [class*="location"]');

      const title = normalize(titleEl?.textContent);
      const url = absolutize(link?.getAttribute('href'));
      if (!title || !url) continue;

      jobs.push({
        title,
        url,
        company: normalize(companyEl?.textContent) || 'Boss Zhipin',
        salary: normalize(salaryEl?.textContent),
        location: normalize(locationEl?.textContent),
      });
    }

    if (jobs.length === 0) {
      for (const link of document.querySelectorAll('a[href*="/job_detail/"]')) {
        const title = normalize(link.textContent);
        const url = absolutize(link.getAttribute('href'));
        if (title && url) {
          jobs.push({ title, url, company: 'Boss Zhipin', salary: '', location: '' });
        }
      }
    }

    const unique = [];
    const seen = new Set();
    for (const job of jobs) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      unique.push(job);
    }

    return {
      blocked,
      textLength: text.length,
      jobs: unique,
      title: document.title,
      finalUrl: location.href,
    };
  });
}

async function scanWithBrowser({ browser, keywords, cities, maxPages, rateLimitMs }) {
  const context = browser.contexts()[0] || await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  });
  const page = await context.newPage();
  const results = [];
  const failures = [];

  try {
    for (const keyword of keywords) {
      for (const city of cities) {
        for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
          const url = buildSearchUrl({ keyword, cityCode: city.code, page: pageNo });
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await page.waitForTimeout(1500);
            const extracted = await extractBossJobs(page);

            if (extracted.blocked || extracted.textLength < 200) {
              failures.push({
                keyword,
                city: city.name,
                page: pageNo,
                reason: extracted.blocked ? 'blocked_or_login_required' : 'empty_or_incomplete_page',
                finalUrl: extracted.finalUrl,
              });
              continue;
            }

            for (const job of extracted.jobs) {
              results.push({
                ...job,
                source: 'boss-zhipin',
                query: keyword,
                city: city.name,
              });
            }
          } catch (err) {
            failures.push({
              keyword,
              city: city.name,
              page: pageNo,
              reason: err.message,
              finalUrl: url,
            });
          }

          await delay(rateLimitMs);
        }
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { results, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portals = readYamlIfExists(PORTALS_PATH);
  const profile = readYamlIfExists(PROFILE_PATH);
  const bossConfig = loadBossConfig();

  if (bossConfig.enabled === false && !args.query) {
    console.error('Boss Zhipin scanning is disabled. Set boss_zhipin.enabled: true in portals.yml or pass --query.');
    process.exit(1);
  }

  const maxPages = Math.max(1, Math.min(5, Number(args.maxPages || bossConfig.max_pages || 1)));
  const rateLimitMs = Math.max(1000, Number(bossConfig.rate_limit_ms || 2500));
  const keywords = deriveKeywords(bossConfig, profile, portals, args.query);
  const cities = deriveCities(bossConfig, profile, args.city);

  if (keywords.length === 0) {
    console.error('No Boss Zhipin keywords found. Add target_roles to config/profile.yml, title_filter.positive to portals.yml, or pass --query.');
    process.exit(1);
  }

  const shouldUseChrome = args.useChrome || bossConfig.access_mode === 'chrome_login';
  if (shouldUseChrome && !args.riskAccepted) {
    console.error(loginRiskWarning());
    console.error('\nTo continue, rerun with --use-chrome --i-understand-login-risk.');
    process.exit(1);
  }

  if (args.dryRun) console.log('(dry run - no files will be written)\n');
  console.log(`Boss Zhipin scan: ${keywords.length} keyword(s), ${cities.length} city/cities, ${maxPages} page(s) each`);

  let browser;
  try {
    if (shouldUseChrome) {
      console.log(loginRiskWarning());
      const connected = await connectToChrome();
      browser = connected.browser;
      console.log(`Using Chrome remote debugging on port ${connected.port}`);
    } else {
      browser = await createPublicBrowser();
      console.log('Using public browser mode');
    }

    const { results, failures } = await scanWithBrowser({
      browser,
      keywords,
      cities,
      maxPages,
      rateLimitMs,
    });

    const titleFilter = buildTitleFilter(portals.title_filter);
    const seenUrls = loadSeenUrls();
    const seenCompanyRoles = loadSeenCompanyRoles();
    const date = new Date().toISOString().slice(0, 10);
    const newOffers = [];
    const historyRows = [];
    let filtered = 0;
    let dupes = 0;

    for (const offer of results) {
      const source = `boss-zhipin:${offer.query}:${offer.city}`;
      if (!titleFilter(offer.title)) {
        filtered++;
        historyRows.push({ ...offer, source, status: 'skipped_title' });
        continue;
      }

      const companyRole = `${offer.company.toLowerCase()}::${offer.title.toLowerCase()}`;
      if (seenUrls.has(offer.url) || seenCompanyRoles.has(companyRole)) {
        dupes++;
        historyRows.push({ ...offer, source, status: 'skipped_dup' });
        continue;
      }

      seenUrls.add(offer.url);
      seenCompanyRoles.add(companyRole);
      newOffers.push({ ...offer, source });
      historyRows.push({ ...offer, source, status: 'added' });
    }

    if (!args.dryRun) {
      appendToPipeline(newOffers);
      appendToScanHistory(historyRows, date);
    }

    console.log('\nBoss Zhipin Scan');
    console.log('----------------');
    console.log(`Jobs found:          ${results.length}`);
    console.log(`Filtered by title:   ${filtered}`);
    console.log(`Duplicates:          ${dupes}`);
    console.log(`New offers added:    ${newOffers.length}`);
    console.log(`Failures:            ${failures.length}`);

    if (newOffers.length > 0) {
      console.log('\nNew offers:');
      for (const offer of newOffers) {
        const place = [offer.location, offer.salary].filter(Boolean).join(' | ') || 'N/A';
        console.log(`  + ${offer.company} | ${offer.title} | ${place}`);
      }
    }

    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const failure of failures.slice(0, 8)) {
        console.log(`  - ${failure.keyword} / ${failure.city} page ${failure.page}: ${failure.reason}`);
      }
      if (!shouldUseChrome) {
        console.log('\nPublic mode could not read every page. If you want to use your logged-in Chrome session, rerun with:');
        console.log('  npm run boss:scan -- --use-chrome --i-understand-login-risk');
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
