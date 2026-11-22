"""Prints the text of each PDF given on the command line, as JSON: {"path": "text", ...}.

Used by lib/congress.js to read House "Periodic Transaction Report" PDFs (they are encrypted
with an empty password, which pypdf opens). Scanned paper filings have no text and come back empty.
Needs: pip install pypdf
"""
import json
import sys

from pypdf import PdfReader

out = {}
for path in sys.argv[1:]:
    try:
        reader = PdfReader(path)
        out[path] = "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as err:  # a broken or unusual PDF shouldn't stop the rest
        out[path] = ""
        print(f"{path}: {err}", file=sys.stderr)
json.dump(out, sys.stdout)
