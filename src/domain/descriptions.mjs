// Description text and provenance always move together. Storefront copy does
// not provide evidence about languages supported inside the game.
const text = value => typeof value === 'string' ? value.trim().slice(0, 4000) : '';
const ranks = {
  steam_tchinese: 800,
  steam_schinese_converted: 700,
  official_zh_tw: 600,
  official_schinese_converted: 590,
  editorial_zh_tw: 550,
};
const labels = {
  steam_tchinese: 'Steam 官方繁中',
  steam_schinese_converted: 'Steam 官方簡中・轉繁',
  official_zh_tw: '官方中文',
  official_schinese_converted: '官方簡中・轉繁',
  editorial_zh_tw: '本站繁中翻譯・依 Steam 商店介紹',
  steam_english: 'Steam 英文原文',
  igdb_original: 'IGDB 英文原文',
};
const blank = () => ({ description: '', descriptionLanguage: '', descriptionSource: '', descriptionSourceUrl: '', descriptionEn: '' });
const englishSource = (record, source) => source.startsWith('steam_') || source === 'editorial_zh_tw'
  ? 'steam_english' : source.startsWith('igdb_') || record.source === 'nintendo' || record.igdb_id
    ? 'igdb_original' : 'steam_english';

export function descriptionSourceURL(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.includes('.') && !url.hostname.endsWith('.local') &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}

function sourceURL(record, source) {
  const explicit = descriptionSourceURL(record.description_source_url ?? record.descriptionSourceUrl);
  const appid = record.steamAppid || record.appid;
  const steamURL = Number.isSafeInteger(Number(appid)) && Number(appid) > 0
    ? `https://store.steampowered.com/app/${Number(appid)}/` : '';
  if (source.startsWith('steam_') || source === 'editorial_zh_tw') {
    if (explicit) {
      const url = new URL(explicit);
      const linkedAppid = url.pathname.match(/^\/app\/([1-9]\d*)(?:\/|$)/)?.[1];
      if (url.hostname === 'store.steampowered.com' && linkedAppid && (!steamURL || Number(linkedAppid) === Number(appid))) return explicit;
    }
    return steamURL;
  }
  if (source.startsWith('igdb_')) {
    return [explicit, descriptionSourceURL(record.url), descriptionSourceURL(record.link)]
      .find(value => value && /(^|\.)igdb\.com$/.test(new URL(value).hostname)) || '';
  }
  return explicit;
}

export function descriptionRecord(record) {
  if (!record || typeof record !== 'object') return blank();
  const normalized = Object.hasOwn(record, 'description');
  const value = text(normalized ? record.description : record.short_description);
  const english = text(normalized ? record.descriptionEn : record.short_description_en);
  const source = text(normalized ? record.descriptionSource : record.short_description_source);
  // Retired automatic translations may remain in cached/public snapshots.
  // Show their saved English original until official Chinese becomes available.
  const automatic = ['steam_machine_zh_tw', 'igdb_machine_zh_tw'].includes(source);
  const language = (normalized ? record.descriptionLanguage : record.short_description_language) ||
    (ranks[source] ? 'zh-TW' : '');
  if (!automatic && value && (language === 'zh-TW' || language === 'en' || language === 'en-US' || language === 'en-GB')) {
    const originalSource = englishSource(record, source);
    const origin = language === 'zh-TW' ? source : originalSource;
    return { description: value, descriptionLanguage: language === 'zh-TW' ? 'zh-TW' : 'en',
      descriptionSource: origin, descriptionSourceUrl: sourceURL(record, origin), descriptionEn: english };
  }
  if (english) {
    // A zh-TW provenance field cannot be attached to the English fallback.
    const origin = englishSource(record, source);
    return { description: english, descriptionLanguage: 'en', descriptionSource: origin,
      descriptionSourceUrl: sourceURL(record, origin), descriptionEn: english };
  }
  return blank();
}

export function chooseDescription(...records) {
  return records.map(descriptionRecord).reduce((best, candidate) => {
    const priority = row => !row.description ? 0 : row.descriptionLanguage === 'zh-TW'
      ? ranks[row.descriptionSource] || 500 : row.descriptionSource === 'steam_english' ? 200 : 100;
    return priority(candidate) > priority(best) ? candidate : best;
  }, blank());
}

export function descriptionLabel(game) {
  if (!game?.description) return '';
  return labels[game.descriptionSource] || (game.descriptionLanguage === 'zh-TW' ? '繁中介紹' : '英文原文');
}

export function renderDescriptionSource(element, game, node) {
  element.replaceChildren();
  const label = descriptionLabel(game);
  element.hidden = !label;
  if (!label) return;
  element.append(node('span', '', label));
  const url = descriptionSourceURL(game.descriptionSourceUrl);
  if (url) {
    const link = node('a', '', '查看原文 ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    element.append(link);
  }
}
