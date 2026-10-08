import { RadarData as SteamData } from "../../domain/index.mjs";
import { timestamp, canonicalID } from "./metrics.js";
function steamStoreURL(appid) {
  const id = canonicalID(appid);
  return id ? `https://store.steampowered.com/app/${id}/` : null;
}
function discovery(value) {
  return value?.schema_version === 1 && timestamp(value.updated_at) && canonicalID(value.steam_source_id) && value.games && typeof value.games === "object" && !Array.isArray(value.games) ? value : null;
}
function proofID(value) { return typeof value === "string" ? canonicalID(value) : null; }
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
}
function validIGDBIdentity(entry, state) {
  const proof = entry?.igdb_identity;
  if (proof == null) return true;
  if (proof.method !== "igdb_external_twitch_uid_v1" || proofID(proof.twitch_game_id) !== canonicalID(entry.twitch_game_id) || proofID(proof.igdb_id) !== canonicalID(entry.igdb_id) || !proofID(proof.twitch_source_id) || proof.twitch_source_id !== canonicalID(state.twitch_source_id) || !timestamp(proof.checked_at) || !timestamp(entry.updated_at) || Date.parse(proof.checked_at) > Date.parse(entry.updated_at) || !Array.isArray(proof.links) || !proof.links.length) return false;
  const ids = new Set();
  return proof.links.every(link => {
    const id = proofID(link?.external_game_id);
    if (!id || ids.has(id) || proofID(link.external_game_source) !== proof.twitch_source_id || proofID(link.uid) !== canonicalID(entry.twitch_game_id) || proofID(link.game) !== canonicalID(entry.igdb_id)) return false;
    ids.add(id);
    return true;
  });
}
function verifiedSteamIdentity(g, state, asOf) {
  const entry = state?.games[g.game_id], gameID = canonicalID(g.game_id);
  if (!entry || !gameID || canonicalID(entry.twitch_game_id) !== gameID || entry.status !== "matched" || entry.active !== true || entry.method !== "twitch_igdb_external_steam_v1" || !timestamp(entry.checked_at) || Date.parse(entry.checked_at) > Date.parse(state.updated_at) || !validIGDBIdentity(entry,state)) return [];
  const igdbID = canonicalID(entry.igdb_id);
  if (!igdbID || g.igdb_id == null && !entry.igdb_identity || g.igdb_id != null && canonicalID(g.igdb_id) !== igdbID || entry.updated_at != null && (!timestamp(entry.updated_at) || Date.parse(entry.updated_at) > Date.parse(state.updated_at))) return [];
  if (entry.igdb_identity && (Date.parse(state.updated_at) > asOf || Date.parse(entry.checked_at) > Date.parse(entry.updated_at))) return [];
  if (!Array.isArray(entry.steam_appids) || !entry.steam_appids.length || entry.steam_appids.some(id => !canonicalID(id)) || !Array.isArray(entry.links)) return [];
  const appids = new Set(entry.steam_appids.map(canonicalID));
  const links = entry.links.flatMap(link => {
    const appid = canonicalID(link?.steam_appid), url = steamStoreURL(appid);
    if (!appid || !canonicalID(link.external_game_id) || canonicalID(link.external_game_source) !== canonicalID(state.steam_source_id) || canonicalID(link.game) !== igdbID || canonicalID(link.uid) !== appid || !appids.has(appid) || link.url !== url) return [];
    return [{ steam_appid:appid, store_url:url, igdb_id:igdbID, checked_at:entry.checked_at, source:entry.method }];
  });
  return [...new Map(links.map(link => [link.steam_appid,link])).values()];
}
function steamSourceAppID(value) {
  if (typeof value !== "string" || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
  return canonicalID(value.match(/^https:\/\/store\.steampowered\.com\/app\/([1-9][0-9]*)(?:\/[A-Za-z0-9_-]+)?\/?$/)?.[1]);
}
function storeDay(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let parts = text.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/) || text.match(/^([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日$/);
  if (!parts) {
    const months = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
    const forward = text.match(/^([0-9]{1,2})\s+([A-Za-z]+)\.?\s*,?\s*([0-9]{4})$/), reverse = text.match(/^([A-Za-z]+)\.?\s+([0-9]{1,2})\s*,?\s*([0-9]{4})$/);
    if (!forward && !reverse) return null;
    const month = months[(forward ? forward[2] : reverse[1]).toLowerCase()];
    if (!month) return null;
    parts = [null,forward ? forward[3] : reverse[3],month,forward ? forward[1] : reverse[2]];
  }
  if (Number(parts[1]) < 1) return null;
  const date = `${String(parts[1]).padStart(4,"0")}-${String(parts[2]).padStart(2,"0")}-${String(parts[3]).padStart(2,"0")}`;
  return SteamData.validDate(date) ? date : null;
}
function verifiedRelatedSteamIdentity(g, state, asOf) {
  const entry = state?.games[g.game_id], proof = entry?.related_steam_identity;
  if (!entry || entry.active !== true || entry.status !== "no_steam_link" || entry.method !== "twitch_igdb_external_steam_v1" || canonicalID(entry.twitch_game_id) !== canonicalID(g.game_id) || !canonicalID(entry.igdb_id) || g.igdb_id != null && canonicalID(g.igdb_id) !== canonicalID(entry.igdb_id) || !validIGDBIdentity(entry,state)) return [];
  if (g.igdb_id == null && !entry.igdb_identity || !timestamp(entry.updated_at) || Date.parse(entry.updated_at) > Date.parse(state.updated_at) || Date.parse(state.updated_at) > asOf || !exactKeys(proof,["method","twitch_game_id","igdb_id","steam_appid","website_links","checked_at","steam_identity_metadata"]) || proof.method !== "twitch_igdb_steam_website_v1" || proofID(proof.twitch_game_id) !== canonicalID(entry.twitch_game_id) || proofID(proof.igdb_id) !== canonicalID(entry.igdb_id) || !timestamp(proof.checked_at) || Date.parse(proof.checked_at) > Date.parse(entry.updated_at)) return [];
  const appid = proofID(proof.steam_appid), url = steamStoreURL(appid), ids = new Set();
  if (!appid || !Array.isArray(proof.website_links) || !proof.website_links.length || !proof.website_links.every(link => {
    const id = proofID(link?.website_id);
    if (!exactKeys(link,["website_id","game","steam_appid","source_url","url"]) || !id || ids.has(id) || proofID(link.game) !== canonicalID(entry.igdb_id) || proofID(link.steam_appid) !== appid || steamSourceAppID(link.source_url) !== appid || link.url !== url) return false;
    ids.add(id);
    return true;
  })) return [];
  const raw = proof.steam_identity_metadata;
  if (!exactKeys(raw,["steam_appid","steam_type","display_name","store_url","sexual_content_screened","content_descriptor_ids","release_store_date","release_date_raw","raw_release_date","checked_at","provider"]) || proofID(raw.steam_appid) !== appid || raw.steam_type !== "game" || raw.sexual_content_screened !== true || !Array.isArray(raw.content_descriptor_ids) || !raw.content_descriptor_ids.every(id => Number.isSafeInteger(id) && id >= 0 && ![3,4].includes(id)) || typeof raw.display_name !== "string" || !raw.display_name.trim() || raw.store_url !== url || raw.provider !== "Steam Store appdetails cc=TW l=tchinese" || raw.checked_at !== proof.checked_at || !exactKeys(raw.raw_release_date,["coming_soon","date"]) || typeof raw.raw_release_date.coming_soon !== "boolean" || typeof raw.release_date_raw !== "string" || raw.raw_release_date.date !== raw.release_date_raw || raw.release_store_date !== storeDay(raw.release_date_raw)) return [];
  const metadata = { ...raw, steam_appid:appid, display_name:raw.display_name.trim(), store_url:url, content_descriptor_ids:[...raw.content_descriptor_ids], raw_release_date:{...raw.raw_release_date} };
  return [{steam_appid:appid,store_url:url,igdb_id:canonicalID(entry.igdb_id),checked_at:proof.checked_at,source:proof.method,steam_identity_metadata:metadata}];
}
function compatibleForwardIdentity(g, identity, state) {
  const forward = state?.games[identity.steam_appid];
  if (forward?.status === "ambiguous" || forward?.status === "matched" && (canonicalID(forward.twitch_game_id) !== canonicalID(g.game_id) || canonicalID(forward.igdb_id) && canonicalID(forward.igdb_id) !== identity.igdb_id)) return false;
  if (["unmatched","pending"].includes(forward?.status)) {
    const decisionAt = timestamp(forward.checked_at) || timestamp(forward.updated_at) || state.updated_at;
    if (Date.parse(decisionAt) >= Date.parse(identity.checked_at)) return false;
  }
  return true;
}
function steamStoreLinks(g) {
  // Store identity never makes a game a member of the published Steam catalog.
  const links = [...(g.steam_matches || []), ...(g.steam_store_links || [])].flatMap(link => {
    const url = steamStoreURL(link.steam_appid);
    return url ? [{ steam_appid:String(link.steam_appid), store_url:url }] : [];
  });
  return [...new Map(links.map(link => [link.steam_appid,link])).values()];
}

export { steamStoreURL, discovery, verifiedSteamIdentity, verifiedRelatedSteamIdentity, compatibleForwardIdentity, steamStoreLinks };
