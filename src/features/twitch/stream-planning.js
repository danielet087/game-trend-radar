import { RadarStorage } from '../../data/storage.ts';
import { RadarData } from '../../domain/index.mjs';
import { archiveGames, selectArchive } from './archive-model.js';
import { regionOf } from './audience-region.js';
import { steamStoreLinks } from './identity.js';
import { canonicalID, HOUR } from './metrics.js';
import { node } from './presentation.js';
import { projectRows } from './region-views.js';
import { dateStart, dayOf, detailHref, fullSeriesRows, heatPath, validChunk, validHeatChunk, validIndex } from './series.js';
import { analyzeStreamHeat, streamHeatDate, streamHeatThrough, STREAM_HEAT_DAYS, STREAM_HEAT_FLOORS } from './stream-heat-model.js';
import { CHINESE_DAILY_HEAT_HITS, PEAK_COOLDOWN, cooldownThreshold } from './cooldown-model.js';
import { select } from './selection.js';
import { latestHistorySnapshot } from './history.js';
import { readCurrentTwitchSnapshot, readPublishedJSON } from './load.js';
import { normalize } from './snapshot.js';
import { publicCatalog } from './model.js';
import { launchAdvice, launchAnchor, launchDays, steamAppOf } from './launch-model.js';
import { launchPeaks } from './launches.js';
import { LAUNCH_RULE_TEXT, PEER_RULE_TEXT } from './launch-advice.js';
import { formatCount as fmt } from './number-format.js';
import { bindInfoNotes, infoHeading } from './info-notes.js';
import { GROUP_ORDER, VERDICT_GROUPS, chineseVerdict, combineVerdicts, extraTags, globalVerdict, launchMeta, recentHours,
  regionTile, shortDate, sortEntries } from './trend-verdict.js';

const REGIONS = ['global', 'zh'];
const REGION_NAMES = { global: '全球', zh: '中文區' };
const SORTS = ['advice', 'viewers', 'change'];
const SOURCES = ['signals', 'twitch_new', 'steam_recent', 'igdb', 'all'];
const CONCURRENCY = 6;
// A group shows its first cards; the rest open with a button.
const GROUP_PREVIEW = 6;
const clock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const updatedAt = value => Number.isFinite(Date.parse(value)) ? clock.format(new Date(value)).replace(/\s+/, ' ') : '';
const hot = fmt(cooldownThreshold('global')), zhLine = fmt(cooldownThreshold('zh')), hours = CHINESE_DAILY_HEAT_HITS;
const GROUP_INFO = {
  hot: [`全球：每天 ${hot} 人以上，還沒退燒。`, `中文區：一天裡至少 ${hours} 個小時有 ${zhLine} 人以上在看。`],
  trial: [`小遊戲（每天沒到過 ${hot} 人）看全球觀眾：首 24 小時 300 人以上、最近一天還有 200 人以上。`,
    '還沒滿 3 天的新遊戲先放這裡，等第 3 天再確認。'],
  horse: ['小遊戲上市第 3 天（48～72 小時）不比首日少、最近一天也不比首日少；一週後還是首日的 2 倍以上叫「延燒中」。'],
  cooled: [`到過每天 ${hot} 人後，連續 3 天低於 ${hot} 人；或高峰到過 ${fmt(PEAK_COOLDOWN.minPeak)} 人後，連續 3 天低於自己高峰的 ${Math.round(PEAK_COOLDOWN.share * 100)}%。`,
    `中文區的熱門線是「一天裡有 ${hours} 個小時 ${zhLine} 人以上」。`],
  skip: ['小遊戲首 24 小時不到 300 人，或最近一天不到 200 人。', `中文區：最近一天不到 ${hours} 個小時過 ${zhLine} 人。`],
};
const REST = {
  skip: { title: '先不用排', reason: { global: '首日不到 300 人或最近一天不到 200 人。', zh: `中文區最近一天不到 ${hours} 個小時過 ${zhLine} 人。` } },
  unknown: { title: '還不能判斷', reason: { global: '剛開始記錄或最近缺資料，滿一天後再看。', zh: '中文區剛開始記錄或最近缺資料，滿一天後再看。' } },
  none: { title: '沒有每小時紀錄', reason: { global: '只有目前的觀眾，不列入建議。', zh: '只有目前的觀眾，不列入建議。' } },
};

async function read(path, validate, force) {
  const result = await RadarStorage.readJSONResult(path, validate, { force, allowStale: false });
  if (!result.data) throw new Error('觀測資料暫時無法讀取');
  return result.data;
}

// The closing view holds only the day's last usable hour; the raw day file
// stays the fallback.
async function readClosingSnapshot(date) {
  const end = dateStart(date) + 24 * HOUR - 1;
  try {
    const latest = latestHistorySnapshot(await readPublishedJSON(`./data/twitch_history_close/${date}.json`, true), end);
    if (latest) return latest;
  } catch { /* An unreadable view never hides the raw day file. */ }
  return latestHistorySnapshot(await readPublishedJSON(`./data/twitch_history/${date}.json`, true), end);
}

async function readHistoricalPlanningSnapshot(date) {
  const [latest, catalog] = await Promise.all([
    readClosingSnapshot(date),
    readPublishedJSON('./data/catalog.json', true).catch(() => null),
  ]);
  if (!latest) return null;
  const snapshot = normalize({ ...latest, schema_version: 2, candidate_games: latest.games });
  // The current catalog only resolves links to game pages.
  return { ...snapshot, public_catalog: publicCatalog(catalog) };
}

function initials(name) {
  const text = String(name || '').trim();
  if (/^[㐀-鿿]/.test(text)) return text[0];
  return text.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || '?';
}

function cover(game) {
  if (game.box_art_url) {
    const image = node('img', 'tw-plan-cover');
    image.src = game.box_art_url; image.alt = ''; image.width = 44; image.height = 58;
    image.loading = 'lazy'; image.decoding = 'async';
    return image;
  }
  const box = node('div', 'tw-plan-cover', initials(game.game_name));
  box.setAttribute('aria-hidden', 'true');
  return box;
}

function chip(verdict, label = verdict.label, className = '') {
  const element = node('span', `tw-verdict-chip ${className}`.trim(), label);
  element.dataset.group = verdict.group;
  return element;
}

function tile(region, value) {
  const box = node('div', 'tw-plan-tile');
  box.dataset.region = region;
  // Hours instead of days: the label shows even where the column heads name the day.
  if (value?.per === '每小時') box.dataset.per = 'hour';
  box.append(node('span', 'tw-plan-tile-label', `${REGION_NAMES[region]}・${value?.per ?? '每天'}`), node('strong', '', value?.value ?? '—'));
  const trend = node('span', 'tw-plan-trend', value?.trend ?? '');
  if (value?.direction) trend.dataset.direction = value.direction;
  box.append(trend);
  if (value?.spark) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 32'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('tw-spark');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', value.spark);
    svg.append(line); box.append(svg);
  }
  return box;
}

export function initStreamPlanningPage() {
  const $ = id => document.getElementById(id);
  const events = new AbortController(), { signal } = events;
  const status = $('streamPlanStatus'), results = $('streamTrendResults'), dateInput = $('streamDate');
  const search = $('gameSearch'), sortSelect = $('gameSort'), regionSelect = $('audienceRegion'), sourceSelect = $('streamSource');
  const refresh = $('streamRefresh'), filters = $('planFilters'), filterToggle = $('planFilterToggle');
  const archiveBox = $('streamArchiveMatches'), archiveMatches = $('streamGameMatches');
  let source = null, snapshot = null, request = 0, selectedDate = null, searchTimer, frame = 0;
  let entries = [], loaded = null, data = null, group = 'all', done = 0;
  const expanded = new Set();
  bindInfoNotes($('streamPlanning'), signal);

  function getSnapshot(date, today, force) {
    if (!force && snapshot?.date === date) return snapshot.promise;
    const promise = date === today ? readCurrentTwitchSnapshot() : readHistoricalPlanningSnapshot(date);
    const current = { date, promise };
    snapshot = current;
    promise.catch(() => { if (snapshot === current) snapshot = null; });
    return promise;
  }

  $('streamTrendRule').textContent = `比較前後各 ${STREAM_HEAT_DAYS} 個已結束日。最近一天和近 ${STREAM_HEAT_DAYS} 日裡至少 2 天，`
    + `比前 ${STREAM_HEAT_DAYS} 日高 1.5 倍以上（且有全球 ${fmt(STREAM_HEAT_FLOORS.global)} 人或中文區 ${fmt(STREAM_HEAT_FLOORS.zh)} 人），標示「回到高檔」：熱度回來了，但不代表還會繼續漲。`
    + `近 ${STREAM_HEAT_DAYS} 日的跌幅只列數字、不標示：新遊戲本來就會一直掉，跌了也不代表之後掉得更多。`;
  $('streamDailyRule').textContent = `中文區一天裡有 ${hours} 個小時達 ${zhLine} 人為「有熱度」，1–${hours - 1} 個小時為「零星有熱度」，0 個小時為「熱度偏低」。缺資料可能改變是否達到 ${hours} 個小時時，先不判斷。`;
  $('streamGlobalRule').textContent = `全球用每天每小時觀眾的中間值，熱門線 ${hot} 人；`
    + `高峰到過 ${fmt(PEAK_COOLDOWN.minPeak)} 人的遊戲，連續 ${PEAK_COOLDOWN.confirmDays} 個完整日低於自己高峰的 ${Math.round(PEAK_COOLDOWN.share * 100)}%，也算已退燒。`
    + `中文區每天的數字取一天裡第 ${hours} 多人的那一小時。每天至少要有 12 個小時的紀錄才算數。`;
  $('streamLaunchRule').textContent = LAUNCH_RULE_TEXT;
  $('streamPeerRule').textContent = PEER_RULE_TEXT;

  function heatHref(id, date, record) {
    const back = new URLSearchParams(location.search);
    back.set('view', 'streamer');
    const url = new URL(detailHref(id, back), location.href);
    url.searchParams.set('region', regionSelect.value);
    const start = dateStart(date);
    if (Date.parse(record?.first_hour) < start + 24 * HOUR && Date.parse(record?.last_hour) >= start) {
      url.searchParams.set('range', 'custom');
      url.searchParams.set('start', date);
      url.searchParams.set('end', date);
    }
    return url.href;
  }

  function saveURL() {
    const url = new URL(location.href);
    for (const [key, value, fallback] of [['q', search.value.trim(), ''], ['state', sourceSelect.value, 'signals'],
      ['sort', sortSelect.value, 'advice'], ['region', regionSelect.value, 'global'], ['group', group, 'all']]) {
      if (value === fallback) url.searchParams.delete(key); else url.searchParams.set(key, value);
    }
    for (const key of ['stream_q', 'stream_limit', 'stream_hour', 'stream_region']) url.searchParams.delete(key);
    if (selectedDate) url.searchParams.set('stream_date', selectedDate); else url.searchParams.delete('stream_date');
    history.replaceState(null, '', url);
  }

  function buildCard(entry, region) {
    const { game } = entry, combined = combineVerdicts(entry.verdicts, region), main = combined.main;
    const card = node('article', 'tw-plan-card');
    card.dataset.game = game.game_id; card.dataset.group = main.group; card.dataset.split = String(combined.split);
    const head = node('div', 'tw-plan-game'), name = node('div', 'tw-plan-name'), titleRow = node('div', 'tw-plan-title-row');
    titleRow.append(node('h3', '', game.game_name));
    titleRow.append(combined.split ? node('span', 'tw-split-chip', '兩區不同') : chip(main, main.label, 'tw-chip-inline'));
    name.append(titleRow);
    if (entry.meta) name.append(node('span', 'tw-plan-meta', entry.meta));
    head.append(cover(game), name);
    // The conclusion only: the verdict and its tags. Why, and the numbers
    // behind the tags, are on the game page (詳細分析).
    const advice = node('div', 'tw-plan-advice');
    if (combined.split) {
      advice.append(node('span', 'tw-split-label', '兩區建議不同'));
      for (const key of [region, REGIONS.find(other => other !== region)]) {
        const verdict = entry.verdicts[key], row = node('div', 'tw-plan-region');
        row.dataset.region = key;
        row.append(node('span', 'tw-plan-region-name', REGION_NAMES[key]), chip(verdict));
        advice.append(row);
      }
    } else {
      advice.append(chip(main, main.label, 'tw-chip-advice'));
      // On a phone that chip sits beside the title, so nothing else here leaves the row out.
      if (!entry.tags.length) card.dataset.advice = 'chip';
    }
    if (entry.tags.length) {
      const tags = node('div', 'tw-plan-tags');
      tags.append(...entry.tags.map(label => node('span', 'tw-plan-tag', label)));
      advice.append(tags);
    }
    const links = node('div', 'tw-plan-links');
    const profile = profileLink(entry);
    if (profile) links.append(profile);
    if (entry.href) {
      const analysis = node('a', 'tw-plan-action', '詳細分析');
      analysis.href = entry.href;
      analysis.setAttribute('aria-label', `詳細分析（${game.game_name}）`);
      links.append(analysis);
    }
    card.append(head, advice, tile('global', entry.tiles.global), tile('zh', entry.tiles.zh), links);
    return card;
  }

  function cardFor(entry, region) {
    entry.cards ||= {};
    if (!entry.cards[region]) entry.cards[region] = buildCard(entry, region);
    return entry.cards[region];
  }

  function plainRow(entry) {
    const row = node('article', 'tw-plan-card tw-plan-plain');
    row.dataset.game = entry.game.game_id; row.dataset.group = entry.state;
    const head = node('div', 'tw-plan-game'), name = node('div', 'tw-plan-name');
    name.append(node('h3', '', entry.game.game_name), node('span', 'tw-plan-meta', entry.state === 'loading' ? '判斷中…' : entry.message ?? ''));
    head.append(cover(entry.game), name);
    row.append(head);
    const profile = profileLink(entry);
    if (profile) {
      const links = node('div', 'tw-plan-links');
      links.append(profile);
      row.append(links);
    }
    return row;
  }

  function groupSection(key, list, region) {
    const section = node('section', 'tw-plan-group');
    section.dataset.group = key;
    const { wrap, heading } = infoHeading('h2', VERDICT_GROUPS[key], { id: `group-${key}-info`, label: `${VERDICT_GROUPS[key]}的標準`,
      lines: GROUP_INFO[key], className: 'tw-plan-group-head' });
    section.setAttribute('aria-labelledby', heading.id);
    const open = expanded.has(key) || group !== 'all', shown = open ? list : list.slice(0, GROUP_PREVIEW);
    section.append(wrap, ...shown.map(entry => cardFor(entry, region)));
    if (shown.length < list.length) {
      const more = node('button', 'tw-plan-show', `再看 ${list.length - shown.length} 款${VERDICT_GROUPS[key]} ↓`);
      more.type = 'button';
      more.addEventListener('click', () => { expanded.add(key); render(); });
      section.append(more);
    }
    return section;
  }

  function restBox(key, list, region) {
    const box = node('details', 'tw-plan-more');
    box.dataset.group = key;
    const summary = node('summary'), names = list.slice(0, 3).map(entry => entry.game.game_name).join('、');
    summary.append(node('strong', '', REST[key].title),
      node('span', '', `${names}${list.length > 3 ? ` 等 ${list.length} 款` : ''}：${REST[key].reason[region]}`));
    box.append(summary, ...list.map(entry => key === 'none' ? plainRow(entry) : cardFor(entry, region)));
    return box;
  }

  function visibleIds() {
    if (!data) return new Set();
    return new Set(select(data.games, { query: search.value, filter: sourceSelect.value, sort: 'viewers' }).map(game => game.game_id));
  }

  function renderArchive(shown) {
    const term = search.value.trim();
    if (!term || !loaded) { archiveBox.hidden = true; archiveMatches.replaceChildren(); return; }
    const games = selectArchive(loaded.games, { query: term, filter: 'all', sort: 'recent' }).filter(game => !shown.has(game.id)).slice(0, 6);
    archiveBox.hidden = !games.length;
    archiveMatches.replaceChildren(...games.map(game => {
      const link = node('a', 'tw-plan-match');
      link.href = heatHref(game.id);
      link.append(node('strong', '', game.displayName), node('span', '', game.status === 'ended' ? '回看歷史判定 →' : '查看詳細分析 →'));
      return link;
    }));
  }

  function render() {
    frame = 0;
    const region = regionSelect.value, sort = sortSelect.value, ids = visibleIds();
    const shown = entries.filter(entry => ids.has(entry.game.game_id));
    const buckets = Object.fromEntries([...GROUP_ORDER, 'unknown', 'none', 'loading'].map(key => [key, []]));
    for (const entry of shown) {
      if (entry.state !== 'ready') buckets[entry.state === 'loading' ? 'loading' : 'none'].push(entry);
      else buckets[combineVerdicts(entry.verdicts, region).main.group].push(entry);
    }
    for (const key of [...GROUP_ORDER, 'unknown']) buckets[key] = sortEntries(buckets[key], sort, region);
    const parts = [];
    if (group === 'all') {
      for (const key of ['hot', 'trial', 'horse', 'cooled']) if (buckets[key].length) parts.push(groupSection(key, buckets[key], region));
      const rest = ['skip', 'unknown', 'none'].filter(key => buckets[key].length).map(key => restBox(key, buckets[key], region));
      if (rest.length) { const box = node('div', 'tw-plan-rest'); box.append(...rest); parts.push(box); }
    } else if (buckets[group].length) parts.push(groupSection(group, buckets[group], region));
    else if (!buckets.loading.length) parts.push(node('p', 'tw-plan-empty', `目前沒有「${VERDICT_GROUPS[group]}」的遊戲。`));
    if (buckets.loading.length) {
      const box = node('section', 'tw-plan-group tw-plan-loading');
      box.dataset.group = 'loading';
      box.append(node('h2', '', '判斷中'), ...buckets.loading.map(plainRow));
      parts.push(box);
    }
    if (data && !shown.length) parts.push(node('p', 'tw-plan-empty', search.value.trim() ? '找不到遊戲，試試英文名稱或遊戲 ID。' : '這個條件下沒有符合的遊戲。'));
    results.replaceChildren(...parts);
    renderArchive(new Set(shown.map(entry => entry.game.game_id)));
    $('planInfoGrouping').textContent = `依現在還值不值得播分組；分組照${REGION_NAMES[region]}的建議，篩選裡可改成照${REGION_NAMES[region === 'zh' ? 'global' : 'zh']}。`;
    for (const button of document.querySelectorAll('#verdictFilters [data-group]')) button.setAttribute('aria-pressed', String(button.dataset.group === group));
    writeStatus(shown.length);
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };

  function writeStatus(count) {
    if (!data) return;
    const pending = entries.filter(entry => entry.state === 'loading').length;
    const today = dayOf(Date.now()) === data.date;
    const when = today ? `${updatedAt(data.generated_at)} 更新` : `${updatedAt(data.generated_at)} 的觀測`;
    status.textContent = pending ? `${when}・正在判斷 ${fmt(done)}／${fmt(entries.length)} 款…`
      : `${when}・${fmt(count)} 款・趨勢算到 ${shortDate(data.through)}`;
  }

  async function observeGame(id, record, archive, date, now, releaseTimes) {
    if (!archive) return { message: '逐時資料暫時無法讀取' };
    if (!Array.isArray(record?.months) || !record.months.length) return { message: '尚無逐時紀錄' };
    try {
      const chunks = Object.fromEntries(await Promise.all(record.months.map(async month => {
        if (!Object.hasOwn(archive.index.months, month)) throw new Error('觀測月份無法確認');
        const key = `${id}/${month}`;
        if (!archive.chunks.has(key)) {
          // The heat file is about a fifth of the month; the full month stays
          // the fallback while a heat file is missing or from another version.
          const pending = read(heatPath(id, month), value => validHeatChunk(value, id, month), archive.force)
            .catch(() => read(`./data/twitch_series/${key}.json`, value => validChunk(value, id, month), archive.force));
          archive.chunks.set(key, pending);
          pending.catch(() => { if (archive.chunks.get(key) === pending) archive.chunks.delete(key); });
        }
        return [month, await archive.chunks.get(key)];
      })));
      const rows = fullSeriesRows(archive.index, chunks, id);
      const days = Object.fromEntries(REGIONS.map(region => [region,
        analyzeStreamHeat(region === 'global' ? rows : projectRows(rows, region), { game: record, region, date, now })]));
      // As of the end of the chosen day, so a past date replays what was known then.
      const asOf = Math.min(now, dateStart(date) + 24 * HOUR), latest = days.global?.outlook.latest;
      // An Early Access game's full release is a launch of its own; streams at
      // launch level just before a launch move where its days start.
      const anchor = launchAnchor(record, rows, asOf, releaseTimes.get(steamAppOf(record) ?? '')), startAt = anchor?.startAt ?? null;
      const launch = { ...launchAdvice({ days: launchDays(rows, startAt, asOf), releaseAt: startAt, now: asOf, rows,
        fallback: latest ? { date: latest.date, median: latest.median } : null }), small: !days.global?.popularAt,
        peaks: launchPeaks(rows, record, asOf), anchor };
      // The tiles' numbers before the first whole day: the hours since the launch, or of the last day.
      const from = launch.stage === 'first' && Number.isFinite(startAt) ? startAt : asOf - 24 * HOUR;
      const sofar = Object.fromEntries(REGIONS.map(region => [region, recentHours(region === 'global' ? rows : projectRows(rows, region), asOf, from)]));
      return { days, launch, sofar };
    } catch { return { message: '逐時資料暫時無法讀取' }; }
  }

  function profileLink(entry) {
    if (!entry.profileHref) return null;
    const link = node('a', 'tw-plan-action', '遊戲頁');
    link.href = entry.profileHref;
    link.setAttribute('aria-label', `遊戲頁（${entry.game.game_name}）`);
    return link;
  }

  async function load(force = false) {
    const now = Date.now(), today = dayOf(now), date = streamHeatDate(selectedDate, now);
    dateInput.max = today;
    dateInput.value = date;
    saveURL();
    const token = ++request;
    const active = () => token === request && !signal.aborted;
    status.textContent = '正在讀取選題清單…';
    entries = []; data = null; done = 0;
    results.replaceChildren();
    results.setAttribute('aria-busy', 'true'); refresh.disabled = true;
    if (!source || force) {
      const pending = read('./data/twitch_series/index.json', validIndex, force)
        .then(index => ({ index, games: archiveGames(index), chunks: new Map(), force }))
        .catch(() => { if (source === pending) source = null; return null; });
      source = pending;
    }
    try {
      const [snapshotData, archive] = await Promise.all([getSnapshot(date, today, force), source]);
      if (!active()) return;
      loaded = archive;
      if (!snapshotData) {
        status.textContent = `${shortDate(date)} 沒有已發布的觀測快照。`;
        renderArchive(new Set());
        return;
      }
      data = { games: snapshotData.games, generated_at: snapshotData.generated_at, date, through: streamHeatThrough(date, now) };
      const games = snapshotData.legacy ? [] : select(snapshotData.games, { filter: 'all', sort: 'viewers' });
      const steamPages = new Map((snapshotData.public_catalog?.games || []).flatMap(raw => {
        const profile = RadarData.normalize(raw, true);
        return profile ? [[String(profile.appid), RadarData.detailURL(profile)]] : [];
      }));
      const releaseTimes = new Map((snapshotData.public_catalog?.games || []).map(raw => [String(raw.appid), raw.release_time_utc]));
      entries = games.map(game => {
        const record = archive?.index.games[game.game_id];
        const profileHref = steamStoreLinks(game).map(item => steamPages.get(item.steam_appid)).find(Boolean) ?? null;
        return { game, record, state: 'loading', profileHref, consoleId: profileHref ? null : canonicalID(game.igdb_id),
          href: record?.archive_eligible === true && Array.isArray(record.months) && record.months.length ? heatHref(game.game_id, date, record) : null };
      });
      render();
      const consoles = entries.filter(entry => entry.consoleId);
      if (consoles.length) {
        RadarStorage.loadNintendo({ force, allowStale: false }).then(catalog => {
          if (!active()) return;
          const pages = new Map();
          for (const profile of RadarData.nintendoGames(catalog)) {
            const id = String(profile.igdbId);
            if (!pages.has(id)) pages.set(id, RadarData.detailURL(profile));
          }
          for (const entry of consoles) {
            const href = pages.get(entry.consoleId);
            if (href) { entry.profileHref = href; entry.cards = null; }
          }
          schedule();
        }).catch(() => { /* Console profiles are independent of the observation list. */ });
      }
      // The visible games first, a few at a time.
      const first = visibleIds();
      const order = [...entries].sort((a, b) => Number(first.has(b.game.game_id)) - Number(first.has(a.game.game_id)));
      let next = 0;
      const worker = async () => {
        while (next < order.length && active()) {
          const entry = order[next++];
          const result = await observeGame(entry.game.game_id, entry.record, archive, date, now, releaseTimes);
          if (!active()) return;
          done++;
          if (result.days) {
            Object.assign(entry, { state: 'ready', days: result.days, launch: result.launch,
              verdicts: { global: globalVerdict(result.days.global, result.launch), zh: chineseVerdict(result.days.zh) },
              tiles: { global: regionTile(result.days.global, 'global', result.sofar.global), zh: regionTile(result.days.zh, 'zh', result.sofar.zh) },
              meta: launchMeta(entry.record, date) });
            entry.tags = extraTags(result.launch, entry.verdicts.global);
          } else Object.assign(entry, { state: 'none', message: result.message });
          schedule();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (!active()) return;
      if (frame) cancelAnimationFrame(frame);
      render();
    } catch {
      if (!active()) return;
      status.textContent = '觀測資料暫時無法讀取。請按重新讀取。';
      results.replaceChildren();
    } finally {
      if (active()) { results.setAttribute('aria-busy', 'false'); refresh.disabled = false; }
    }
  }

  const rerender = () => { saveURL(); render(); };
  dateInput.addEventListener('change', () => {
    const now = Date.now(), date = streamHeatDate(dateInput.value, now);
    selectedDate = date === dayOf(now) ? null : date;
    load();
  }, { signal });
  refresh.addEventListener('click', () => load(true), { signal });
  sourceSelect.addEventListener('change', rerender, { signal });
  regionSelect.addEventListener('change', rerender, { signal });
  sortSelect.addEventListener('change', rerender, { signal });
  search.addEventListener('input', event => {
    clearTimeout(searchTimer);
    if (!event.isComposing) searchTimer = setTimeout(rerender, 140);
  }, { signal });
  search.addEventListener('compositionend', rerender, { signal });
  $('verdictFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-group]');
    if (!button) return;
    group = button.dataset.group;
    rerender();
  }, { signal });
  filterToggle.addEventListener('click', () => {
    const open = filterToggle.getAttribute('aria-expanded') !== 'true';
    filterToggle.setAttribute('aria-expanded', String(open));
    filters.classList.toggle('is-open', open);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !event.target.closest?.('input,textarea,select,[contenteditable]')) {
      event.preventDefault();
      search.focus();
    }
  }, { signal });

  const params = new URLSearchParams(location.search);
  search.value = (params.get('q') || params.get('stream_q') || '').slice(0, 160);
  sourceSelect.value = SOURCES.includes(params.get('state')) ? params.get('state') : 'signals';
  sortSelect.value = SORTS.includes(params.get('sort')) ? params.get('sort') : 'advice';
  regionSelect.value = regionOf(params.get('region') ?? params.get('stream_region'));
  group = ['all', ...GROUP_ORDER].includes(params.get('group')) ? params.get('group') : 'all';
  const now = Date.now(), date = streamHeatDate(params.get('stream_date'), now);
  selectedDate = date === dayOf(now) ? null : date;
  load();
  return { destroy() { events.abort(); clearTimeout(searchTimer); if (frame) cancelAnimationFrame(frame); } };
}
