import sqlite3

db_path = r"C:\Users\Hugo\Documents\GitHub\AntigravityMobileCompanion\daemon\AntigravityDaemon.Api\antigravity_companion.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
print("Tables in database:")
for t in tables:
    print(t[0])
conn.close()
