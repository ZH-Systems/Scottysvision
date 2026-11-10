import base64
import io
import os
import unittest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
import pymupdf
from main import app

class OCRIntegrationTests(unittest.TestCase):
    def setUp(self):
        os.environ['OCR_SERVICE_TOKEN'] = 'fixture-token'
        os.environ.pop('MODEL_BASE_URL', None)
        os.environ.pop('MODEL_NAME', None)
        self.client = TestClient(app)
    def payload(self, data, mime='image/png'):
        return {'file': {'name': 'receipt', 'mime': mime, 'base64': base64.b64encode(data).decode()}}
    def test_real_image_ocr_and_verifier(self):
        image = Image.new('RGB', (1300, 600), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 42)
        draw.multiline_text((40, 40), 'Supplier\nFlour 20.00\nSubtotal 20.00\nHST 2.60\nTOTAL 22.60', fill='black', font=font, spacing=25)
        data = io.BytesIO(); image.save(data, format='PNG')
        response = self.client.post('/extract', json=self.payload(data.getvalue()), headers={'Authorization':'Bearer fixture-token'})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['invoice']['subtotal'], 20)
        self.assertEqual(result['invoice']['total'], 22.6)
        self.assertIsNone(result['invoice']['lines'][0]['packQty'])
        checked = self.client.post('/verify', json=result, headers={'Authorization':'Bearer fixture-token'})
        self.assertEqual(checked.status_code, 200, checked.text)
    def test_pdf_text_extraction(self):
        doc=pymupdf.open();page=doc.new_page();page.insert_text((50,50),'Supplier\nFlour 20.00\nSubtotal 20.00\nTOTAL 20.00');data=doc.tobytes();doc.close()
        response=self.client.post('/extract',json=self.payload(data,'application/pdf'),headers={'Authorization':'Bearer fixture-token'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['invoice']['total'],20)
    def test_unauthorized_and_invalid_data(self):
        self.assertEqual(self.client.post('/extract',json=self.payload(b'bad')).status_code,401)
        self.assertEqual(self.client.post('/extract',json=self.payload(b'bad'),headers={'Authorization':'Bearer fixture-token'}).status_code,422)

if __name__=='__main__':unittest.main()
