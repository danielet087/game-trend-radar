"""Offline Steam Store Browse language-support behavior and safe metadata updates."""
import copy
import unittest

from scripts.refresh_steam_game_languages_once import (
    official_chinese_title, read_support, update_titles,
)


class SteamGameLanguageTests(unittest.TestCase):
    def test_supported_languages_enum_traditional_7_simplified_6_english_0(self):
        self.assertEqual(
            read_support({"supported_languages": [
                {"elanguage": 0, "supported": True},
                {"elanguage": 6, "supported": True},
                {"elanguage": 7, "supported": True},
            ]}),
            {"tchinese": True, "schinese": True, "english": True},
        )
        self.assertEqual(
            read_support({"supported_languages": [
                {"elanguage": 0, "supported": True},
                {"elanguage": 6, "supported": True},
                {"elanguage": 7, "supported": False},
            ]}),
            {"tchinese": False, "schinese": True, "english": True},
        )
        self.assertEqual(
            read_support({"supported_languages": [
                {"elanguage": 0, "supported": True},
                {"elanguage": 27, "supported": True},
            ]}),
            {"tchinese": False, "schinese": False, "english": True},
        )
        self.assertEqual(read_support({}), {
            "tchinese": None, "schinese": None, "english": None,
        })

    def test_store_chinese_titles_only_if_real_localized_han_name(self):
        self.assertEqual(official_chinese_title("神鬼寓言"), "神鬼寓言")
        self.assertEqual(official_chinese_title("《夜城狂想》Nivalis Nights"),
                         "《夜城狂想》Nivalis Nights")
        self.assertIsNone(official_chinese_title("Fable"))

    def test_update_preserves_release_followers_images_and_original_name(self):
        rows = [{
            "appid": 2769570, "name": "Fable", "followers": 8500,
            "release_start": "2027-02-24",
            "header_image": "untouched",
        }]
        original = copy.deepcopy(rows[0])
        result = update_titles(rows, {
            2769570: {
                "name_english": "Fable", "name_tchinese": "Fable",
                "name_schinese": "神鬼寓言",
                "support": {
                    "tchinese": False, "schinese": True, "english": True,
                },
            },
        })
        self.assertEqual(rows[0]["name_en"], "Fable")
        self.assertEqual(rows[0]["name_zh_cn"], "神鬼寓言")
        self.assertNotIn("name_zh_tw", rows[0])
        self.assertEqual(rows[0]["language_support"]["tchinese"], False)
        self.assertEqual(result["simplified_only"], 1)
        for key in original:
            self.assertEqual(rows[0][key], original[key])


if __name__ == "__main__":
    unittest.main()
