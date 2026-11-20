// 平台版本: one row per tracked platform (a table on wide screens, cards on
// phones). Every platform-specific fact is said here once — date, Chinese,
// play modes, edition, store and the Steam price — and all provenance goes to
// a single collapsed "資料來源與說明" list, each distinct note only once.
import { playModes } from './overview.js';
import { weekday } from './radar.js';
import { priceText, discountText, taipeiTime } from './store.js';

const VERSION_NAMES = { Steam: 'Steam 版', NS: 'Nintendo Switch 版', NS2: 'Nintendo Switch 2 版', PS5: 'PlayStation 5 版' };
const PLATFORM_ORDER = ['Steam', 'NS', 'NS2', 'PS5'];
// Known platforms the radar does not follow, by IGDB platform ID.
const OTHER_PLATFORM_NAMES = { 6: 'PC', 14: 'Mac', 3: 'Linux', 48: 'PS4', 49: 'Xbox', 169: 'Xbox', 39: 'iOS', 34: 'Android' };
const PC_PLATFORM_IDS = new Set([6, 14, 3]);

export const versionName = code => VERSION_NAMES[code] || `${code} 版`;
export const platformTone = code => code === 'Steam' ? 'steam' : code === 'PS5' ? 'playstation' : 'nintendo';

/** Platforms the game is known to be on that the radar does not track. */
export function otherPlatforms(game) {
  const tracked = new Set(game?.platforms || []);
  const names = [];
  for (const row of Array.isArray(game?.knownPlatforms) ? game.knownPlatforms : []) {
    if (row?.code && tracked.has(row.code)) continue;
    // The Windows/Mac/Linux build is the Steam version when Steam is tracked.
    if (tracked.has('Steam') && PC_PLATFORM_IDS.has(row?.id)) continue;
    const name = row?.code || OTHER_PLATFORM_NAMES[row?.id] || (typeof row?.name === 'string' ? row.name.trim().slice(0, 40) : '');
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function releaseDayText(days) {
  return days === null ? '日期待確認' : days > 0 ? `還有 ${days} 天` : days === 0 ? '今天發售' : `已發售 ${-days} 天`;
}

// "11/20 確認": when a source was last checked, in Taiwan time.
const checkedDay = value => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return '';
  const day = new Date(time + 8 * 3600000).toISOString().slice(5, 10);
  return `${day.replace('-', '/')} 確認`;
};

export function createDetailVersions(ctx, policy) {
  const { $, node, D, today } = ctx;
  const { nativePlatforms, regionLabel, regionDateLabel, publicSourceURL, officialReleaseClock, unifiedIGDBRelease,
    taiwanOfficialRelease, hongKongOfficialRelease, nativeOfficialRelease, releaseSourceName,
    releaseDateNote, detailReleaseRows } = policy;
  const days = date => D.validDate(date) ? Math.round((Date.parse(date + 'T12:00:00Z') -
    Date.parse(today + 'T12:00:00Z')) / 86400000) : null;

  function link(text, url, className = '') {
    const anchor = node('a', className, text);
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  }

  function dateBadge(row) {
    if (row.platform === 'Steam') return '';
    // The same words as the calendar and the cards: whose day it is, and that Taiwan is unconfirmed.
    if (unifiedIGDBRelease(row)) return `${regionDateLabel(row.region)}・台灣待確認`;
    if (taiwanOfficialRelease(row)) return '台灣官方';
    if (hongKongOfficialRelease(row)) return '香港官方';
    return row.region === 'taiwan' ? '台灣日期待確認' : `${regionDateLabel(row.region)}・台灣待確認`;
  }

  function dateCell(rows, heroDate, listed) {
    const cell = node('td', 'game-version-dates');
    cell.dataset.label = '發售日（台灣）';
    if (!rows.length) {
      // No release at all for this version is unknown here, not "to be announced".
      const line = node('p', 'game-version-date is-unknown', listed ? '日期未定' : D.releaseStateText?.unlisted || '日期未收錄');
      if (!listed) line.title = D.unlistedReleaseNote || '';
      cell.append(line);
      return cell;
    }
    for (const row of rows) {
      const line = node('p', 'game-version-date');
      // Steam's planned time is shown until launch; an official console time always.
      const clock = row.platform !== 'Steam' ? officialReleaseClock(row) : days(row.date) >= 0 ? D.releaseClock?.(row) : null;
      const time = node('time', '', `${row.date.replaceAll('-', '/')}（${weekday(row.date)}）${clock ? ` ${clock.time}` : ''}`);
      time.dateTime = clock?.utc || row.date;
      line.append(time);
      const badge = dateBadge(row);
      if (badge) line.append(node('span', 'game-version-badge', badge));
      // The title card already counts down to its own date.
      if (row.date !== heroDate) line.append(node('span', 'game-version-countdown', releaseDayText(days(row.date))));
      cell.append(line);
    }
    return cell;
  }

  function support(game, code) {
    if (code !== 'Steam') return game.platformLanguages?.[code] || D.platformLanguageSupport?.(null, code) || D.nintendoLanguageSupport();
    return { languageBadges: game.languageBadges || [{ label: '語言支援待確認', status: 'unknown' }],
      complete: game.languages?.tchinese === false && game.languages?.schinese === false, steam: true };
  }

  function languageCell(game, code) {
    const cell = node('td', 'game-version-languages');
    cell.dataset.label = '中文';
    const info = support(game, code);
    // A complete official list (or Steam's own flags) can say "no Chinese"; a
    // partial list only says Chinese is unconfirmed.
    const noChinese = info.steam ? info.complete : info.complete === true && info.languages?.chinese === false;
    const chips = node('div', 'game-version-chips');
    chips.append(...(info.languageBadges || []).map(badge => {
      const other = badge.label.replace(/^支援/, '');
      const text = badge.status === 'traditional' ? '繁中' : badge.status === 'simplified' ? '簡中'
        : badge.status === 'chinese' ? '中文（字體待確認）'
          : badge.status === 'unknown' ? '語言待確認'
            : noChinese ? `無中文（有${other}）` : `${other}（中文待確認）`;
      return node('span', `game-version-lang is-${badge.status}`, text);
    }));
    cell.append(chips);
    if (!info.steam && info.status !== 'unknown' && info.supported_languages?.length)
      cell.append(node('p', 'game-version-meta', `共 ${info.supported_languages.length} 種語言`));
    return cell;
  }

  function modeCell(game, code) {
    const cell = node('td', 'game-version-modes');
    cell.dataset.label = '遊玩方式';
    const mode = playModes({ ...game, platforms: [code] })[0];
    if (mode) cell.append(node('p', '', mode.text));
    else cell.classList.add('is-empty');
    return cell;
  }

  function storeLink(game, code) {
    if (code === 'Steam') {
      const url = game.steamLink || (game.source !== 'nintendo' ? game.link : '');
      return url ? { code, url, label: 'Steam 商店' } : null;
    }
    const merchant = game.platformLinks?.[code];
    const url = merchant && D.platformURL?.(merchant.url, code);
    if (!url) return null;
    const label = code === 'PS5' ? new URL(url).hostname === 'store.playstation.com' ? 'PlayStation 商店' : 'PlayStation 官網'
      : 'Nintendo 官網';
    return { code, url, label };
  }

  function storeCell(game, code, store) {
    const cell = node('td', 'game-version-store');
    cell.dataset.label = '商店';
    const target = storeLink(game, code);
    if (target) {
      const button = link(`${target.label} ↗`, target.url, 'game-version-shop');
      button.setAttribute('aria-label', `在 ${target.label}開啟 ${game.name}（另開分頁）`);
      cell.append(button);
    }
    // Only Steam publishes a Taiwan price the radar can check.
    if (code === 'Steam' && store?.price) {
      const price = node('p', 'game-version-price', priceText(store.price));
      const discount = discountText(store.price);
      if (discount) price.append(node('span', 'game-version-meta', discount));
      cell.append(price, node('p', 'game-version-meta', `Steam 台灣商店 ${taipeiTime(store.checkedAt)} 確認`));
    }
    if (!cell.children.length) cell.classList.add('is-empty');
    return { cell, target };
  }

  // The Steam version of a console game carries only its Store title.
  function edition(game, code) {
    const value = game.platformEditions?.[code];
    if (code === 'Steam') return value?.title && /^https:\/\/store\.steampowered\.com\/app\/[1-9]\d*\/$/.test(value.source_url || '') ? value : null;
    return value?.label && value.title && publicSourceURL(value.source_url) ? value : null;
  }

  function platformCell(game, code, badge) {
    const cell = node('th', 'game-version-platform');
    cell.setAttribute('scope', 'row');
    cell.append(node('span', `game-version-chip is-${platformTone(code)}`, badge?.label || code));
    cell.append(node('strong', 'game-version-name', versionName(code)));
    const version = edition(game, code);
    if (version) {
      const box = node('p', 'game-version-edition');
      if (version.label) box.append(node('span', 'game-version-badge is-edition', version.label));
      box.append(node('span', 'game-version-meta', `商店名稱：${version.title}`));
      cell.append(box);
    }
    return cell;
  }

  // Provenance: each distinct sentence once, with the platforms it covers.
  function sourceNotes(game, rowsByPlatform) {
    const notes = new Map();
    const add = (key, platforms, build) => {
      if (!notes.has(key)) notes.set(key, { platforms: [], build });
      for (const code of platforms) if (!notes.get(key).platforms.includes(code)) notes.get(key).platforms.push(code);
    };
    const prefix = (platforms, topic) => `${platforms.map(versionName).join('、')}${topic}：`;
    for (const [code, rows] of rowsByPlatform) {
      if (code === 'Steam') {
        // A planned clock time is the developer's setting on Steam, so it can still move.
        const planned = rows.some(row => days(row.date) >= 0 && D.releaseClock?.(row));
        if (rows.length) add(`date:steam${planned ? ':clock' : ''}`, [code], platforms => [prefix(platforms, '發售日'),
          `來源 Steam 台灣商店。${planned ? '時間是開發商在 Steam 設定的發售時間，換算成台灣時間（UTC+8）；發售前仍可能調整。' : ''}`]);
        continue;
      }
      for (const row of rows) {
        const sourceURL = nativeOfficialRelease(row) ? publicSourceURL(row.official_source_url) : publicSourceURL(row.source);
        const name = releaseSourceName(row), note = releaseDateNote(row);
        add(`date:${name}|${sourceURL}|${note}`, [code], platforms => [prefix(platforms, '發售日'), '來源 ',
          sourceURL ? link(name, sourceURL) : name, `。${note}`]);
      }
    }
    for (const code of rowsByPlatform.keys()) {
      if (code === 'Steam') {
        const both = game.languages?.tchinese === true && game.languages?.schinese === true;
        const text = both ? 'Steam 商店標示同時支援繁中與簡中；介面、字幕與配音的細項請以商店為準。'
          : game.languageStatus === 'traditional' ? 'Steam 商店標示支援繁中；介面、字幕與配音的細項請以商店為準。'
            : game.languageStatus === 'simplified' ? 'Steam 商店標示支援簡中；尚未標示繁中支援。'
              : game.languageStatus === 'english' ? 'Steam 商店未標示支援繁中或簡中，但有支援英文。'
                : game.languageStatus === 'other' ? 'Steam 商店未標示支援繁中、簡中或英文，請至商店查看其他支援語言。'
                  : 'Steam 尚未提供足以確認的語言資訊，請以官方商店語言表為準。';
        add(`lang:steam:${text}`, [code], platforms => [prefix(platforms, '中文'), text]);
        continue;
      }
      const info = support(game, code);
      if (info.status === 'unknown') {
        add('lang:unknown', [code], platforms => [prefix(platforms, '中文'), '尚無可確認的官方語言資料。']);
        continue;
      }
      const facts = [];
      if (info.languages.chinese === true && info.languages.tchinese === null && info.languages.schinese === null)
        facts.push('官方僅標示中文，尚未區分繁體／簡體字體。');
      if (info.complete && info.languages.tchinese === false) facts.push('官方完整語言列表未列繁體中文。');
      if (info.complete && info.languages.schinese === false) facts.push('官方完整語言列表未列簡體中文。');
      if (info.region !== 'taiwan') facts.push('台灣販售版本的語言是否相同仍待確認。');
      const region = info.region === 'worldwide' ? '全球公告' : `${regionLabel(info.region)}版本`;
      const listed = `已公布語言：${info.supported_languages.map(row => row.name).join('、')}。`;
      const checked = checkedDay(info.checked_at);
      add(`lang:${info.source}|${info.source_url}|${region}|${listed}|${facts.join('')}|${checked}`, [code], platforms => [
        prefix(platforms, '中文'), `${region}，來源 `, link(info.source, info.source_url),
        `${checked ? `（${checked}）` : ''}。${listed}${facts.join('')}`]);
    }
    for (const code of rowsByPlatform.keys()) {
      const version = code !== 'Steam' && edition(game, code);
      if (!version) continue;
      const unified = (rowsByPlatform.get(code) || []).some(unifiedIGDBRelease);
      const content = version.type === 'deluxe' ? '此平台發售的是上述 Deluxe 版本。' : '此平台發售的是包含本體與追加內容的版本。';
      const scope = version.region === 'taiwan' ? '版本內容依台灣官方商品頁確認。'
        : '版本內容依此地區商品頁確認；台灣販售版本是否相同仍待確認。';
      add(`edition:${code}`, [code], platforms => [prefix(platforms, '販售版本'),
        `官方商品名稱「${version.title}」，${regionLabel(version.region)}版本，來源 `,
        link(`${code === 'PS5' ? 'PlayStation' : 'Nintendo'} 官方商品頁`, publicSourceURL(version.source_url)),
        `。${content}${unified ? '發售日期採 IGDB 平台資料。' : '發售日期對應上述版本與內容組合。'}${scope}`]);
    }
    const modes = playModes(game);
    if (modes.length) {
      const sources = [...new Set(modes.map(mode => mode.source === 'Steam' ? 'Steam 遊玩類別' : 'IGDB 遊戲模式'))].join('、');
      add('modes', [], () => ['遊玩方式：', `${sources}。`]);
    }
    if ([...rowsByPlatform.keys()].some(code => nativePlatforms.includes(code)))
      add('policy', [], () => ['各平台、地區版本的語言分開確認；中文名稱不代表遊戲支援中文。']);
    return [...notes.values()].map(({ platforms, build }) => {
      const item = node('li');
      item.append(...build(platforms).map(part => typeof part === 'string' ? ctx.document.createTextNode(part) : part));
      return item;
    });
  }

  /** Renders the section and returns the store targets for the page's buy buttons. */
  function render(game, store = null, heroDate = '') {
    const platforms = PLATFORM_ORDER.filter(code => game.platforms?.includes(code));
    const rows = detailReleaseRows(game);
    const rowsByPlatform = new Map(platforms.map(code => [code,
      rows.filter(row => row.platform === code).sort((a, b) => a.date.localeCompare(b.date))]));
    const badges = new Map((game.platformBadges || []).map(badge => [badge.label.replace(/\s*獨佔$/, ''), badge]));
    const selected = rows[0];
    const targets = [];
    $('gameVersionRows').replaceChildren(...platforms.map(code => {
      const line = node('tr', 'game-version');
      line.dataset.platform = code;
      const dates = rowsByPlatform.get(code);
      if (dates[0]) line.dataset.date = dates[0].date;
      if (selected?.platform === code) line.dataset.selected = 'true';
      const { cell, target } = storeCell(game, code, store);
      if (target) targets.push(target);
      const listed = (game.releases || []).some(row => row?.platform === code);
      line.append(platformCell(game, code, badges.get(code)), dateCell(dates, heroDate, listed),
        languageCell(game, code), modeCell(game, code), cell);
      return line;
    }));
    const others = otherPlatforms(game);
    $('gameVersionsAlso').hidden = !others.length;
    $('gameVersionsAlso').textContent = others.length
      ? `也在 ${others.join('、')} 推出；本站沒有追蹤${others.length > 1 ? '這些' : '這個'}平台的日期與語言。` : '';
    $('gameVersionSourceList').replaceChildren(...sourceNotes(game, rowsByPlatform));
    $('gameVersions').hidden = !platforms.length;
    return targets;
  }

  return { render, storeLink };
}
