import { otherPlatforms, platformTone } from './versions.js';

// The title card's chips: release state (one per state when platforms differ),
// the tracked platforms (an official exclusive keeps its label) and, outlined,
// platforms the radar does not track.
const STATE_CLASS = { released: "released", today: "today", upcoming: "upcoming", undated: "unknown" };

export function createDetailMetadata(ctx) {
  const { $, node, D, today } = ctx;
  function renderHeroChips(game, days) {
    const state = days === null ? ["日期未定", "unknown"] : days > 0 ? ["即將上市", "upcoming"]
      : days === 0 ? ["今天發售", "today"] : ["已發售", "released"];
    // Platforms on different days each say where they stand: "Steam 已發售"、"NS2 即將上市".
    const groups = D.releaseStatusGroups?.(game, today) || [];
    const status = groups.length > 1
      ? groups.map(group => node("span", `game-title-chip is-state is-${STATE_CLASS[group.state]}`,
        `${group.platforms.join("、")} ${D.releaseStateText[group.state]}`))
      : [node("span", `game-title-chip is-state is-${state[1]}`, state[0])];
    const tracked = (game.platformBadges || []).filter(badge => badge.status !== "multi").map(badge => {
      const code = badge.label.replace(/\s*獨佔$/, "");
      const chip = node("span", `game-title-chip is-${platformTone(code)}`, badge.label);
      chip.title = badge.title || game.platformLabel || badge.label;
      return chip;
    });
    const others = otherPlatforms(game).map(name => {
      const chip = node("span", "game-title-chip is-other", name);
      chip.title = "也在此平台推出；本站沒有追蹤這個平台";
      return chip;
    });
    $("gamePlatforms").replaceChildren(...status, ...tracked, ...others);
    $("gamePlatforms").hidden = false;
  }
  return { renderHeroChips };
}
