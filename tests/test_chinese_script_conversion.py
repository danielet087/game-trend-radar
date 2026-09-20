"""Verify source language metadata and original Chinese Steam names survive."""
import unittest

from scripts.convert_public_names_to_traditional_once import convert_names


class ScriptConversionTests(unittest.TestCase):
    def test_real_names_from_public_steam_catalog(self):
        rows = [
            {"appid": 4019220, "name": "Dressmaker", "name_en": "Dressmaker",
             "name_zh_cn": "针影裁梦",
             "language_support": {"tchinese": False, "schinese": True,
                                  "english": True},
             "followers": 12629, "release_start": "2026-09-22"},
            {"appid": 4094660, "name": "Rivage", "name_zh_cn": "她在时间之外",
             "language_support": {"schinese": True, "tchinese": False}},
        ]
        summary = convert_names(rows)
        self.assertEqual(rows[0]["name_zh_cn_traditional"], "針影裁夢")
        self.assertEqual(rows[1]["name_zh_cn_traditional"], "她在時間之外")
        self.assertEqual(rows[0]["name_zh_cn"], "针影裁梦")
        self.assertEqual(rows[1]["name_zh_cn"], "她在时间之外")
        self.assertFalse(rows[0]["language_support"]["tchinese"])
        self.assertTrue(rows[0]["language_support"]["schinese"])
        self.assertEqual(rows[0]["followers"], 12629)
        self.assertEqual(summary["cn_changed"], 2)

    def test_existing_traditional_chinese_is_preserved(self):
        rows = [{"appid": 4115450, "name_zh_tw": "影之刃零",
                 "name_zh_cn": "影之刃零", "name_en": "Phantom Blade Zero"}]
        convert_names(rows)
        self.assertEqual(rows[0]["name_zh_tw_traditional"], "影之刃零")

    def test_fallback_original_title_in_chinese_is_converted(self):
        rows = [{"appid": 17, "name_en": "迷雾冒险", "name": "迷雾冒险"}]
        convert_names(rows)
        self.assertEqual(rows[0]["name_en_traditional"], "迷霧冒險")
        self.assertEqual(rows[0]["name"], "迷雾冒险")


if __name__ == "__main__":
    unittest.main()
