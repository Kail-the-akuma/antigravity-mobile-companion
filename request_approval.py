import sys
import json
import urllib.request
import urllib.error

def request_approval(prompt, steps):
    url = "http://localhost:5117/api/approvals/request"
    payload = {
        "Prompt": prompt,
        "PlanStepsJson": steps,
        "TaskId": "00000000-0000-0000-0000-000000000000"
    }
    
    # Safely format steps by resolving raw escape sequences
    formatted_steps = steps.replace("\\n", "\n")
    
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json; charset=utf-8'}, method='POST')
    
    print("\n\033[96m========================================================================\033[0m")
    print("\033[92m[COMPANION APPROVAL GATEWAY]\033[0m")
    print("\033[96m========================================================================\033[0m")
    print(f"\033[96m[*] Sending approval request to Companion Mobile...\033[0m")
    print(f" -> Prompt: {prompt}")
    print(f" -> Steps for review:\n")
    print(f"\033[37m{formatted_steps}\033[0m")
    print("\033[96m------------------------------------------------------------------------\033[0m")
    print("\033[93m[WAIT] Waiting for biometric verification on paired mobile device...\033[0m", flush=True)
    
    try:
        # Timeout after 130 seconds
        with urllib.request.urlopen(req, timeout=130) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            status = res_data.get("status")
            signature = res_data.get("signature")
            
            if status == "Approved":
                print(f"\n\033[92m[APPROVED] Execution plan authorized on mobile device.\033[0m")
                print(f"\033[96m[SIGNATURE] Cryptographic symmetric signature verified:\033[0m")
                print(f"   \033[90m{signature}\033[0m")
                print("\033[96m========================================================================\033[0m")
                sys.exit(0)
            elif status == "Rejected":
                print(f"\n\033[91m[REJECTED] Execution plan denied by user on mobile device.\033[0m")
                print("\033[96m========================================================================\033[0m")
                sys.exit(1)
            else:
                print(f"\n\033[93m[!] Invalid status returned: {status}\033[0m")
                print("\033[96m========================================================================\033[0m")
                sys.exit(1)
    except urllib.error.URLError as e:
        print(f"\n\033[91m[FAIL] No response from Companion Daemon or timeout exceeded.\033[0m")
        print(f"Details: {e}")
        print("\033[96m========================================================================\033[0m")
        sys.exit(1)
    except Exception as e:
        print(f"\n\033[91m[ERROR] Unexpected execution failure: {e}\033[0m")
        print("\033[96m========================================================================\033[0m")
        sys.exit(1)

if __name__ == "__main__":
    prompt_arg = "Solicitação de Aprovação do Agente"
    steps_arg = "1. Executar tarefa"
    
    if len(sys.argv) > 1:
        prompt_arg = sys.argv[1]
    if len(sys.argv) > 2:
        steps_arg = sys.argv[2]
        
    request_approval(prompt_arg, steps_arg)
