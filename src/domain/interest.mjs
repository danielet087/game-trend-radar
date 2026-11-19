// Console interest: IGDB hypes, or for NS/NS2 games admitted by it an IGDB PopScore rank.
const number = new Intl.NumberFormat('zh-TW');

/** A PopScore rank in percent (1 is the most visited or wanted), or null. */
export function popscoreTop(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;
}

/** How a console game earned its place, ready to show; null when nothing is known. */
export function consoleInterest(game) {
  if (game?.popularityBasis === 'igdb_popscore') {
    const top = popscoreTop(game.popscoreTop);
    return top === null
      ? { basis: 'igdb_popscore', value: '上榜', unit: 'IGDB 熱度', text: 'IGDB 熱度上榜',
        title: 'IGDB 頁面瀏覽或「想玩」曾排進 NS／NS2 遊戲前 20%' }
      : { basis: 'igdb_popscore', value: `前 ${top}%`, unit: 'IGDB 熱度', text: `IGDB 熱度前 ${top}%`,
        title: `IGDB 頁面瀏覽或「想玩」在 NS／NS2 遊戲中排名前 ${top}%` };
  }
  if (!Number.isSafeInteger(game?.hypes)) return null;
  return { basis: 'hypes', value: number.format(game.hypes), unit: 'IGDB hypes',
    text: `IGDB ${number.format(game.hypes)} hypes`, title: 'IGDB hypes：遊戲整體的發售前關注數' };
}

/** Console order: hypes-admitted games by hypes, then PopScore-admitted ones by rank. */
export function consoleInterestCompare(a, b) {
  const rank = game => game.popularityBasis === 'igdb_popscore'
    ? [1, popscoreTop(game.popscoreTop) ?? 101]
    : [0, -(Number.isSafeInteger(game.hypes) ? game.hypes : -1)];
  const [left, right] = [rank(a), rank(b)];
  return left[0] - right[0] || left[1] - right[1];
}
