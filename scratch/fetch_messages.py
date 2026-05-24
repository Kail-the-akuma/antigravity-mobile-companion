import sqlite3
import hmac
import hashlib
import json
import urllib.request
from datetime import datetime

# 1. Get paired device identity from sqlite database
db_path = r"C:\Users\Hugo\Documents\GitHub\AntigravityMobileCompanion\daemon\AntigravityDaemon.Api\antigravity_companion.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT Id, SecretKey FROM TrustedDevices LIMIT 1")
device = cursor.fetchone()
conn.close()

if not device:
    print("No paired device found.")
    exit(1)

device_id, secret_key = device
print(f"Paired Device ID: {device_id}")

conv_id = "10f12d40-e1ab-44da-b14d-e45dbbb97bc7"
print(f"Conversation ID: {conv_id}")

# 3. Build signed headers
url = f"http://localhost:5117/api/conversations/{conv_id}/messages"
timestamp = datetime.utcnow().isoformat() + "Z"
nonce = "testnonce12345"

# SHA256 signature
msg = f"|{timestamp}|{nonce}|{secret_key}"
signature = hashlib.sha256(msg.encode('utf-8')).hexdigest().lower()

req = urllib.request.Request(url)
req.add_header("X-Device-Id", device_id)
req.add_header("X-Timestamp", timestamp)
req.add_header("X-Nonce", nonce)
req.add_header("X-Signature", signature)
req.add_header("Content-Type", "application/json")

# 4. Make request
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        data = json.loads(html)
        print("Response JSON:")
        print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error: {e}")
