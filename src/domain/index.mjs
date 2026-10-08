import { validDate, todayInTaipei, offsetDate } from './dates.mjs';
import { savedID, saveID, isSaved, gameKey, nintendoSteamIdentity } from './identity.mjs';
import { nativePlatformIDs, nativePlatformOrder } from './constants.mjs';
import { cardPlatformBadge } from './platforms.mjs';
import { cardMultiplayerBadge } from './multiplayer.mjs';
import { nintendoURL, platformURL, nintendoLanguageURL, nintendoHongKongDateURL } from './storefronts.mjs';
import { platformLanguageSupport, nintendoLanguageSupport, nintendoCardLanguages } from './languages.mjs';
import { platformEdition, nintendoEdition, releaseEditionBadges, releaseDisplayNames } from './editions.mjs';
import { nintendoReleaseAudited, officialTaiwanReleaseTime } from './release-audit.mjs';
import { detailURL, popularityCompare, calendarFeatured, unique, cardGames, selectGames } from './collections.mjs';
import { imageURL, exactReleaseDate, hasTwitchAdmission, hasTaiwanStoreDateAuthority, isTwitchQualified, normalize } from '../data/steam.mjs';
import { nintendoGames } from '../data/native.mjs';
import { datasets } from '../data/datasets.mjs';

// Migration facade: legacy pages can keep their established API while modules
// and new views import individual domain rules without global dependencies.
export const RadarData = {
  validDate, todayInTaipei, offsetDate, imageURL, exactReleaseDate,
  hasTwitchAdmission, hasTaiwanStoreDateAuthority, isTwitchQualified, normalize,
  savedID, saveID, isSaved, gameKey, nativePlatformIDs, nativePlatformOrder,
  cardPlatformBadge, cardMultiplayerBadge, nintendoSteamIdentity, nintendoURL,
  platformURL, platformLanguageSupport, platformEdition,
  nativeCardLanguages: nintendoCardLanguages,
  nativeReleaseAudited: nintendoReleaseAudited,
  nintendoHongKongDateURL, officialTaiwanReleaseTime, nintendoLanguageURL,
  nintendoLanguageSupport, nintendoCardLanguages, nintendoEdition,
  releaseEditionBadges, releaseDisplayNames, nintendoGames, detailURL,
  popularityCompare, calendarFeatured, unique, cardGames, datasets, selectGames,
};

export {
  validDate, todayInTaipei, offsetDate, imageURL, exactReleaseDate,
  hasTwitchAdmission, hasTaiwanStoreDateAuthority, isTwitchQualified, normalize,
  savedID, saveID, isSaved, gameKey, nativePlatformIDs, nativePlatformOrder,
  cardPlatformBadge, cardMultiplayerBadge, nintendoSteamIdentity, nintendoURL,
  platformURL, platformLanguageSupport, platformEdition,
  nintendoHongKongDateURL, officialTaiwanReleaseTime, nintendoLanguageURL,
  nintendoLanguageSupport, nintendoCardLanguages, nintendoEdition,
  releaseEditionBadges, releaseDisplayNames, nintendoGames, detailURL,
  popularityCompare, calendarFeatured, unique, cardGames, datasets, selectGames,
};
export { nintendoReleaseAudited as nativeReleaseAudited } from './release-audit.mjs';
export { nintendoCardLanguages as nativeCardLanguages } from './languages.mjs';
export { normalizeBoundary } from '../data/boundary.mjs';
export default RadarData;
