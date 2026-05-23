import sys
import json
import urllib.request
import urllib.error

def send_mobile_report(conversation_id, content):
    url = f"http://localhost:5117/api/conversations/remote/{conversation_id}/agent-message"
    payload = {
        "Content": content
    }
    
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json; charset=utf-8'}, method='POST')
    
    print(f"\033[96m[REPORT] A sincronizar e a enviar relatorio final para o telemovel...\033[0m")
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            print(f"\n\033[92m[SUCCESS] ENVIADO! O relatorio final esta agora visivel no ecra do Companion Mobile.\033[0m")
            print(f"[REPORT] Remote Conversation ID: \033[90m{conversation_id}\033[0m")
            sys.exit(0)
    except urllib.error.URLError as e:
        print(f"\n\033[91m[FAIL] FALHA ao comunicar relatorio com o Companion Daemon.\033[0m")
        print(f"Detalhe: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\033[91m[ERROR] ERRO INESPERADO: {e}\033[0m")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Erro: Parâmetros obrigatórios ausentes. Uso: python send_mobile_report.py <ConversationId> <Content>")
        sys.exit(1)
        
    send_mobile_report(sys.argv[1], sys.argv[2])
