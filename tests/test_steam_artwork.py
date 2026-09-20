"""Offline checks for one-time Steam image sync; no network or Followers."""
import unittest

from scripts.refresh_steam_artwork_once import enrich, steam_asset_url


class SteamArtworkTests(unittest.TestCase):
    def test_actual_hashed_asset_paths(self):
        self.assertEqual(
            steam_asset_url(
                2769570, "steam/apps/2769570/${FILENAME}?t=123",
                "abcdef012345/header.jpg",
            ),
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2769570/abcdef012345/header.jpg?t=123",
        )

    def test_legacy_asset_format(self):
        self.assertEqual(
            steam_asset_url(730, "steam/apps/730/${FILENAME}", "header.jpg"),
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg",
        )

    def test_never_copy_another_game_or_untrusted_host(self):
        for fmt in (
            "steam/apps/730/${FILENAME}",
            "https://malicious.example/steam/apps/2769570/${FILENAME}",
            "steam/apps/2769570/../../${FILENAME}",
        ):
            self.assertEqual(steam_asset_url(2769570, fmt, "header.jpg"), "")

    def test_never_overwrite_existing_fields_with_missing_assets(self):
        games = [{"appid": 730, "followers": 5500,
                  "header_image": "https://shared.akamai.steamstatic.com/original.jpg"}]
        self.assertEqual(enrich(games, {730: {"main_capsule_image": ""}}), (0, 0))
        self.assertEqual(games[0]["followers"], 5500)
        self.assertEqual(
            games[0]["header_image"],
            "https://shared.akamai.steamstatic.com/original.jpg",
        )


if __name__ == "__main__":
    unittest.main()
