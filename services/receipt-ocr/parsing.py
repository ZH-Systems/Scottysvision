"""Conservative text fallback. Missing package sizes are never inferred."""
import re
from decimal import Decimal, InvalidOperation

def decimal(value):
    if value is None or str(value).strip() == "":
        return None
    try:
        number = Decimal(str(value).replace(",", ""))
    except InvalidOperation as error:
        raise ValueError("Invalid extracted number") from error
    if not number.is_finite() or number < 0 or number > Decimal("1000000000"):
        raise ValueError("Extracted number is outside the supported range")
    return float(number)

def normalize(invoice):
    if not isinstance(invoice, dict) or not isinstance(invoice.get("lines"), list):
        raise ValueError("Expected an invoice with a lines array")
    result = {key: str(invoice.get(key) or "")[:300] for key in ("vendor", "number", "date", "notes")}
    for key in ("subtotal", "tax", "total"):
        result[key] = decimal(invoice.get(key))
    result["lines"] = []
    for line in invoice["lines"][:200]:
        item = {"description": str(line.get("description") or "")[:300], "packUnit": line.get("packUnit") if line.get("packUnit") in ("g", "kg", "mL", "L", "ea", "oz", "lb") else None}
        for key in ("packages", "packQty", "netSubtotal", "tax"):
            item[key] = decimal(line.get(key))
        result["lines"].append(item)
    return result

def extract_text(text):
    rows = [line.strip() for line in text.splitlines() if line.strip()]
    result = {"vendor": rows[0] if rows else "", "number": "", "date": "", "notes": "OCR text extraction. Verify every populated value against the original.", "subtotal": None, "tax": None, "total": None, "lines": []}
    tax_rows = 0
    for row in rows:
        number = re.search(r"(?:invoice|receipt)\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})", row, re.I)
        if number:
            result["number"] = number.group(1)
        date = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", row)
        if date:
            result["date"] = date.group(1)
        price = re.search(r"\$?([\d,]+\.\d{2})\s*$", row)
        if not price:
            continue
        amount = decimal(price.group(1))
        if re.search(r"sub\s*total", row, re.I):
            result["subtotal"] = amount
        elif re.search(r"\b(tax|hst|gst|pst)\b", row, re.I):
            # Multiple separately printed taxes require manual reconciliation.
            tax_rows += 1
            result["tax"] = amount if tax_rows == 1 else None
        elif re.search(r"\b(total|amount due)\b", row, re.I):
            result["total"] = amount
        elif not re.search(r"\b(cash|change|visa|mastercard|debit|tender|payment|balance)\b", row, re.I):
            description = row[:price.start()].strip()
            if description:
                result["lines"].append({"description": description, "packages": None, "packQty": None, "packUnit": None, "netSubtotal": amount, "tax": None})
    return normalize(result)
