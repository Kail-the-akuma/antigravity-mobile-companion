import sqlite3

db_path = r"C:\Users\Hugo\Documents\GitHub\AntigravityMobileCompanion\daemon\AntigravityDaemon.Api\antigravity_companion.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("\nLast 5 messages:")
cursor.execute("SELECT Id, ConversationId, Role, Content, Timestamp FROM ConversationMessages ORDER BY Timestamp DESC LIMIT 5")
rows = cursor.fetchall()
for r in rows:
    print(f"Id: {r[0]}")
    print(f"ConversationId: {r[1]}")
    print(f"Role: {r[2]}")
    print(f"Content: {r[3][:100]}")
    print(f"Timestamp: {r[4]}")
    print("-" * 50)

conn.close()
