import sqlite3
import hashlib
import json
import urllib.request
import urllib.error
import time
from datetime import datetime

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
print(f"Device ID: {device_id}")

conv_id = "10f12d40-e1ab-44da-b14d-e45dbbb97bc7"

# Use ISO 8601 string format
timestamp = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
nonce = "testnonce" + str(time.time())

msg = f"|{timestamp}|{nonce}|{secret_key}"
signature = hashlib.sha256(msg.encode('utf-8')).hexdigest().lower()

url = f"http://localhost:5117/api/conversations/{conv_id}/messages"
req = urllib.request.Request(url)
req.add_header("X-Device-Id", device_id)
req.add_header("X-Timestamp", timestamp)
req.add_header("X-Nonce", nonce)
req.add_header("X-Signature", signature)
req.add_header("Content-Type", "application/json")

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        print("Success! Response:")
        print(json.dumps(data, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(e.read().decode('utf-8'))
except Exception as e:
    print(f"Error: {e}")
