# Training a custom ATC model

This folder builds a **small, fast, ATC-only** model to replace `qwen2.5:14b` for the brain's
language tasks. Because the deterministic engine owns all the facts, the model only has to do one
narrow job — turn pilot speech into an intent — so a 0.5–3B fine-tuned model can match or beat the
14b at **a fraction of the latency**, which matters a lot when the model runs on CPU (MSFS keeps
the GPU).

Two design rules are baked into the data:
1. **ATC only, never a chatbot.** Off-topic input is labeled `unknown`; the Modelfile system prompt
   reinforces it. The model won't answer general questions or act as a co-pilot.
2. **Robust to messy text.** Typos, dropped words, slang, casing, and run-ons are all mapped to the
   *closest valid request* — so real, sloppy radio calls still parse.

## TL;DR — is this even necessary?

Try the free option first: in the app, set the model to **`qwen2.5:3b`** or **`qwen2.5:1.5b`**
(`ollama pull qwen2.5:3b`). With the rules-first NLU, that's often fast *and* accurate enough, and
costs zero training. Fine-tune only if a stock small model mislabels too much.

## Pipeline

```
gen-data.mjs  →  atc-nlu.jsonl  →  train_qlora.py  →  LoRA  →  merge  →  GGUF  →  Ollama
   (Node)         (dataset)         (Python/QLoRA)             (merge)   (llama.cpp)  (Modelfile)
```

### 1. Generate the dataset (Node — no Python needed)

```powershell
node training/gen-data.mjs --n 6000
# optional: also have the 14b label extra-hard messy cases (Ollama must be running)
node training/gen-data.mjs --n 8000 --teacher
```
Writes `training/data/atc-nlu.jsonl`. Each line is `{"prompt","completion"}` using the **exact**
prompt the brain sends, so the result is a drop-in.

### 2. Fine-tune (Python — needs an NVIDIA GPU, or CPU with patience)

```powershell
# Use Python 3.10-3.12 (NOT 3.13/3.14 — PyTorch/bitsandbytes have no stable wheels there yet).
py -3.12 -m venv .venv ; .venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cu121   # GPU (RTX etc.)
pip install -r training/requirements.txt
python training/train_qlora.py                  # trains -> training/out/atc-lora/checkpoint-*
python training/train_qlora.py --merge --out training/out/atc-lora/checkpoint-<N>  # -> ...-merged
```

Training auto-stops when held-out accuracy plateaus and keeps the best checkpoint. Reference run:
**Qwen2.5-1.5B, 5.5 GB VRAM, ~99% on the synthetic eval after one epoch, ~97% on hand-written novel
phrasings** after one targeted-data iteration (see `stress_test.py`).

**VRAM budget.** Defaults are tuned to fit **~5 GB** (1.5B base, 4-bit QLoRA, batch 2, gradient
checkpointing) so an 8 GB card keeps ~3 GB free for your display while training. Control it:

```powershell
python training/train_qlora.py --vram-budget 4          # cap at 4 GB
python training/train_qlora.py --base Qwen/Qwen2.5-0.5B-Instruct --vram-budget 4   # smallest/fastest
python training/train_qlora.py --base Qwen/Qwen2.5-3B-Instruct  --vram-budget 7    # best accuracy, ~7 GB
```

Rough fit: **0.5B ≈ 2 GB · 1.5B ≈ 3.5 GB · 3B ≈ 6 GB** (training, 4-bit). The `--vram-budget` flag
hard-caps the process so it stays in budget instead of grabbing the whole card. If you hit an
out-of-memory error, drop `--batch` to 1, lower `--max-len`, or use a smaller `--base`.

### 3. Load into Ollama (no llama.cpp needed)

Modern Ollama (≈0.1.30+) imports HF safetensors directly and converts to GGUF on `create` — so you
can skip llama.cpp entirely. Point the Modelfile's `FROM` at your merged dir and:

```powershell
ollama create atc-nlu -f training/Modelfile
```

(If you prefer GGUF yourself, convert with [llama.cpp](https://github.com/ggerganov/llama.cpp)'s
`convert_hf_to_gguf.py` and set `FROM ./out/atc-merged.gguf` instead.)

> **Gotcha:** do **not** add `PARAMETER stop "}"` to the Modelfile. With Ollama's JSON mode it cuts
> off the closing brace and breaks JSON parsing. JSON mode already stops correctly.

### 4. Use it

Set **`OLLAMA_MODEL=atc-nlu`** in `.env` (or choose it in **Setup → AI model**) and restart the brain.
Validate quickly:

```powershell
python training/stress_test.py --model training/out/atc-lora/checkpoint-<N>   # offline accuracy
npm run spike:ollama                                                           # live, via Ollama
```

## Results (reference run)

| Model        | NLU accuracy (novel input) | Latency / call |
| ------------ | -------------------------- | -------------- |
| `atc-nlu` (1.5B fine-tune) | ~97%          | ~430 ms        |
| `qwen2.5:14b` (general)    | good          | ~1270 ms (GPU) |

The custom model is **~3× faster on GPU** (and far more on CPU, where the 14b actually runs since MSFS
takes the GPU) **and more accurate on messy ATC phrasing** — because it's trained for exactly this one job.

## Notes

- **Quality:** more *variety* helps the messy cases most. Use `--teacher`, add phrasing templates to
  `gen-data.mjs`, and re-train if odd phrasings slip — measure with `stress_test.py`, don't guess.
- **Smaller/faster:** train `--base Qwen/Qwen2.5-0.5B-Instruct` for an even snappier model.
- **NLG too?** This pipeline targets NLU (intent parsing), which is where the LLM actually runs in
  the hot path; phraseology is template-based in the engine. The same approach extends to NLG if you
  later route phrasing through the model — just add those pairs to the generator.
- Generated data and model outputs (`training/data/`, `training/out/`) are gitignored.
