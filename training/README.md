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

### 2. Fine-tune (Python — needs a GPU with ~6+ GB VRAM, or CPU with patience)

```powershell
python -m venv .venv ; .venv\Scripts\activate
# GPU users: install a CUDA torch build from https://pytorch.org first
pip install -r training/requirements.txt
python training/train_qlora.py                  # -> training/out/atc-lora
python training/train_qlora.py --merge          # -> training/out/atc-merged
```
Pick the base with `--base` (default `Qwen/Qwen2.5-1.5B-Instruct`; try `0.5B` for max speed or `3B`
for max accuracy).

### 3. Convert to GGUF (for Ollama)

Use [llama.cpp](https://github.com/ggerganov/llama.cpp)'s converter on the merged model:

```powershell
python llama.cpp/convert_hf_to_gguf.py training/out/atc-merged --outfile training/out/atc-merged.gguf --outtype q8_0
```

### 4. Load into Ollama and use it

```powershell
ollama create atc-nlu -f training/Modelfile
```
Then set **`OLLAMA_MODEL=atc-nlu`** in `.env` (or choose it in **Setup → AI model**). Done — the
brain now uses your fast custom model. Validate with:

```powershell
npm run spike:ollama          # reachability + tok/s
```

## Notes

- **Speed:** a Q8 1.5B model is typically 5–15× faster than the 14b on CPU; a 0.5B is faster still.
- **Quality:** more data helps the messy cases most. Bump `--n` and re-train if odd phrasings slip.
- **NLG too?** This pipeline targets NLU (intent parsing), which is where the LLM actually runs in
  the hot path; phraseology is template-based in the engine. The same approach extends to NLG if you
  later route phrasing through the model — just add those pairs to the generator.
- Generated data and model outputs (`training/data/`, `training/out/`) are gitignored.
