import unittest
from parsing import extract_text, normalize

class ReceiptTests(unittest.TestCase):
    def test_unknown_packages_stay_unknown(self):
        result = extract_text("Supplier\nFlour 20.00\nSubtotal 20.00\nHST 2.60\nTOTAL 22.60")
        self.assertEqual(result["lines"][0]["netSubtotal"], 20)
        self.assertIsNone(result["lines"][0]["packages"])
        self.assertEqual(result["tax"], 2.6)
    def test_invalid_numbers_rejected(self):
        with self.assertRaises(ValueError):
            normalize({"lines": [{"netSubtotal": "nan"}]})
    def test_payment_is_not_an_ingredient(self):
        result = extract_text("Store\nFlour 2.00\nVISA 2.00")
        self.assertEqual(len(result["lines"]), 1)

if __name__ == "__main__":
    unittest.main()
