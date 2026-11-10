# Receipt extraction service

An independent HTTP service for Vision's receipt pipeline. Native PDF text is read with PyMuPDF; scanned pages and images use Tesseract. An optional OpenAI-compatible model structures and verifies extracted text. Without a model, conservative text parsing returns candidate amounts and leaves package measurements unknown.

## Run

Install Docker with Compose. In this directory, create an untracked `.env` containing a strong random `OCR_SERVICE_TOKEN`. Optionally add `MODEL_BASE_URL` (the provider's OpenAI-compatible base URL ending in `/v1`), `MODEL_NAME` and `MODEL_API_KEY`.

```bash
docker compose up -d --build
```

The service listens on host loopback port 8080. Put your authenticated HTTPS reverse proxy in front of it. In Vercel set `VISION_OCR_API_URL=https://YOUR_OCR_HOST/extract` and `VISION_OCR_API_KEY` to the same private token. Never send the token to the browser. Configure external model retention/access policies to match your receipt data requirements.

## Contract

`POST /extract`, `Authorization: Bearer <OCR_SERVICE_TOKEN>`, JSON:

```json
{
  "file": { "name": "receipt.pdf", "mime": "application/pdf", "base64": "BASE64_BYTES" },
  "currency": "CAD"
}
```

Response contains `invoice` with `vendor`, `number`, `date`, `subtotal`, `tax`, `total`, `lines`; each line has `description`, `packages`, `packQty`, `packUnit`, `netSubtotal`, `tax`. It also returns `text`. Unknown values are null. Output is a candidate requiring human review.

`POST /verify` accepts `{ "text": "...", "invoice": {...} }` and returns the same structured invoice contract. This endpoint uses the configured model when present, otherwise conservative parsing. To run it as Vision's independent second call, set `VISION_VERIFY_API_URL=https://YOUR_OCR_HOST/verify` and `VISION_VERIFY_API_KEY`. A separate instance/provider can be used for independence.

Limits include 16 MB input, 10 PDF pages, bounded rendered image size, and bounded OCR/model time. Files stay in process memory and are not persisted. The Compose definition binds only loopback, requires a token, and limits CPU/memory. Proxy authentication does not replace the service bearer check.

## Tests

```bash
python -m pip install -r requirements.txt
# Install the OS tesseract-ocr package first.
python -m unittest discover -s . -p 'test_*.py'
```

Tests cover conservative parsing, malformed input, bearer authentication, native PDF text and actual image OCR. Model-provider calls require a configured external model and are not exercised by these offline tests.
