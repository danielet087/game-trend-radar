"""Offline checks for Steam-sourced Traditional Chinese names only."""
import copy
import unittest

from scripts.refresh_steam_traditional_names_once import add_names, official_zh_title


class NameTests(unittest.TestCase):
    def test_official_chinese_title_and_combined_title(self):
        self.assertEqual(official_zh_title("Phantom Blade Zero", "影之刃零"), "影之刃零")
        self.assertEqual(
            official_zh_title("Nivalis Nights", "《夜城狂想》Nivalis NIghts"),
            "《夜城狂想》Nivalis NIghts",
        )

    def test_steam_no_chinese_means_english_fallback(self):
        self.assertIsNone(official_zh_title("Fable", "Fable"))
        self.assertIsNone(official_zh_title("Fable", ""))
        self.assertIsNone(official_zh_title("Fable", None))
        self.assertIsNone(official_zh_title("Fable", "Fable: Anniversary"))

    def test_update_only_localization_never_release_art_follower_or_english(self):
        row = {"appid": 4115450, "name": "Phantom Blade Zero",
               "followers": 109984, "release_start": "2026-10-29",
               "header_image": "original-header"}
        old = copy.deepcopy(row)
        self.assertEqual(add_names([row], {4115450: "影之刃零"}), 1)
        self.assertEqual(row["name_en"], "Phantom Blade Zero")
        self.assertEqual(row["name_zh_tw"], "影之刃零")
        assert {k: row[k] for k in old} == old

    def test_existing_localized_name_remains_if_store_returns_english(self):
        row = {"appid": 10, "name": "Fable", "name_zh_tw": "已審核繁中"}
        self.assertEqual(add_names([row], {10: "Fable"}), 0)
        self.assertEqual(row["name_zh_tw"], "已審核繁中")


if __name__ == "__main__":
    unittest.main()
