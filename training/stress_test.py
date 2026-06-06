#!/usr/bin/env python
"""
Stress-test the fine-tuned ATC NLU model on NOVEL, hand-written transmissions that deliberately
do NOT match gen-data.mjs templates. 100% on synthetic data is easy; this measures real
generalization. Whatever fails here is what to add targeted training data for.

Usage:
    python training/stress_test.py                       # test the LoRA in training/out/atc-lora
    python training/stress_test.py --model training/out/atc-merged   # test a merged model
    python training/stress_test.py --base-only           # baseline: untuned base model

Each case is (transmission, expected_intent). 'unknown' = should be refused (not a chatbot).
"""
import argparse
import json

# Hand-written, off-template cases. Real pilots are messy, terse, and inconsistent.
CASES = [
    # --- clearance, phrased oddly ---
    ("uhh yeah ground we'd like our ifr when you get a sec", "request_ifr_clearance"),
    ("got a clearance for us?", "request_ifr_clearance"),
    ("standing by to copy", "request_ifr_clearance"),
    ("can we get cleared to klax", "request_ifr_clearance"),
    # --- pushback / taxi, terse ---
    ("ready to push whenever", "request_pushback"),
    ("push approved on our end, ready", "request_pushback"),
    ("can we start taxiing", "request_taxi"),
    ("where do you want us to taxi", "request_taxi"),
    ("ready to roll to the runway", "request_taxi"),
    # --- departure ---
    ("good to go on the runway", "ready_for_departure"),
    ("we're set, holding short 16", "ready_for_departure"),
    ("all buttoned up ready when you are", "ready_for_departure"),
    # --- go around ---
    ("yeah we're taking it around", "go_around"),
    ("balked landing, going up", "go_around"),
    # --- VFR / flight following ---
    ("can we get advisories down to san diego", "request_flight_following"),
    ("requesting traffic advisories vfr", "request_flight_following"),
    # --- pattern / touch and go ---
    ("we wanna stay in the pattern for a bit", "request_pattern"),
    ("this one'll be a stop and go actually", "touch_and_go"),
    ("planning the option this time around", "touch_and_go"),
    ("full stop this time", "full_stop"),
    # --- hold ---
    ("we need to hold somewhere, can't continue", "request_hold"),
    # --- readback (should classify as readback) ---
    ("ok climbing five thousand squawk 4521 southwest 12", "readback"),
    ("roger tower 118.3 see ya", "readback"),
    # --- NON-ATC: must be 'unknown' (anti-chatbot) ---
    ("what's the weather in tokyo", "unknown"),
    ("can you help me land this thing im scared", "unknown"),
    ("whats the best plane in the sim", "unknown"),
    ("tell me about yourself", "unknown"),
    ("how much fuel do i have", "unknown"),
    ("play some music", "unknown"),
]

INTENTS = ["request_ifr_clearance", "request_pushback", "request_taxi", "ready_for_departure",
           "go_around", "request_flight_following", "request_pattern", "touch_and_go",
           "full_stop", "request_hold", "readback", "unknown"]

def intent_prompt(text):
    return ('You classify a single pilot radio transmission. Return ONLY JSON:\n'
            '{"intent": one of ["' + '","'.join(INTENTS) + '"], "atis_info": single letter A-Z or null}\n\n'
            f'Pilot: "{text}"\nJSON:')

def main():
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--model", default="training/out/atc-lora", help="LoRA adapter dir or merged model dir")
    ap.add_argument("--base-only", action="store_true", help="Test the untuned base (baseline).")
    args = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForCausalLM.from_pretrained(
        args.base, torch_dtype=torch.float16,
        device_map="auto" if torch.cuda.is_available() else None)
    if not args.base_only:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.model)
    model.eval()

    fails = []
    correct = 0
    for text, want in CASES:
        inp = tok(intent_prompt(text), return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**inp, max_new_tokens=40, do_sample=False, pad_token_id=tok.eos_token_id)
        gen = tok.decode(out[0][inp["input_ids"].shape[1]:], skip_special_tokens=True)
        got = None
        try:
            got = json.loads(gen[gen.index("{"): gen.index("}") + 1]).get("intent")
        except Exception:
            pass
        ok = got == want
        correct += ok
        mark = "OK " if ok else "XX "
        print(f"[{mark}] want={want:24s} got={str(got):24s} | {text}")
        if not ok:
            fails.append((text, want, got))

    print(f"\n=== {correct}/{len(CASES)} correct ({correct/len(CASES)*100:.0f}%) on novel cases ===")
    if fails:
        print("\nFAILURES (candidates for targeted training data):")
        for text, want, got in fails:
            print(f"  - \"{text}\"  -> got {got}, want {want}")

if __name__ == "__main__":
    main()
