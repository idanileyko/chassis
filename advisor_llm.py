#!/usr/bin/env python3
"""CHASSIS council brain bridge.

Reads one JSON request from stdin:  {"system": str, "user": str, "temperature": float}
Writes one JSON response to stdout: {"content": str}  or  {"error": str}

Brain priority:
  1. agent-gw (Kimi) — only if a Kimi credential is present in the environment.
  2. pollinations.ai OpenAI-compatible endpoint — credential-free fallback for
     environments (like this sandbox) where agent-gw is quota-blocked.

The Node side treats any error/timeout as "council offline" and degrades to a
structured fallback opinion, so a dead brain never wedges the chassis.
"""
import json
import os
import sys
import urllib.request


def brain_agentgw(system: str, user: str, temperature: float) -> str:
    from agent_gw import AgentGwClient

    model = os.environ.get("COUNCIL_MODEL", "kimi-k2")
    client = AgentGwClient()
    try:
        resp = client.chat_completion(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=temperature,
            timeout=90,
        )
    finally:
        try:
            client.close()
        except Exception:
            pass
    return resp["choices"][0]["message"]["content"]


def brain_pollinations(system: str, user: str, temperature: float) -> str:
    payload = {
        "model": os.environ.get("COUNCIL_FALLBACK_MODEL", "openai"),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "private": True,
    }
    req = urllib.request.Request(
        "https://text.pollinations.ai/openai",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    return data["choices"][0]["message"]["content"]


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
        system = str(req["system"])
        user = str(req["user"])
        temperature = float(req.get("temperature", 0.5))
    except Exception as e:
        print(json.dumps({"error": f"bad request: {e}"}))
        return

    brains = []
    if os.environ.get("KIMI_API_KEY") or os.environ.get("KIMI_AGENTGW_API_KEY"):
        brains.append(("agent-gw", brain_agentgw))
    brains.append(("pollinations", brain_pollinations))

    errors = []
    for name, fn in brains:
        try:
            content = fn(system, user, temperature)
            print(json.dumps({"content": content, "brain": name}))
            return
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}: {e}")
    print(json.dumps({"error": " | ".join(errors) or "no brains configured"}))


if __name__ == "__main__":
    main()
