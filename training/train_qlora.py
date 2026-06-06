#!/usr/bin/env python
"""
QLoRA fine-tune a small base model into a dedicated ATC NLU model.

Teaches a tiny model (default Qwen2.5-1.5B-Instruct) the brain's exact NLU task:
  pilot transmission (possibly messy) -> {"intent": ..., "atis_info": ...}
so the running app can swap the 14b for something many times faster on the same hardware.

Data: training/data/atc-nlu.jsonl  (produced by gen-data.mjs), lines of {"prompt","completion"}.

Quick start (needs an NVIDIA GPU with ~6+ GB VRAM, or CPU with patience):
    pip install -r training/requirements.txt
    node training/gen-data.mjs --n 6000           # build the dataset
    python training/train_qlora.py                # fine-tune -> training/out/atc-lora
    python training/train_qlora.py --merge        # merge LoRA into base -> training/out/atc-merged

Then convert to GGUF + load into Ollama (see training/README.md).
"""
import argparse
import json
import os

from datasets import load_dataset


def parse_args():
    p = argparse.ArgumentParser()
    # Defaults are tuned to fit a ~5 GB VRAM budget (1.5B base, 4-bit QLoRA, batch 2, grad
    # checkpointing), leaving headroom on an 8 GB card for your display/OS while training.
    p.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct",
                   help="Base model. 1.5B fits ~5 GB. Use 0.5B for max speed / smaller budget; 3B needs ~7 GB.")
    p.add_argument("--data", default=os.path.join("training", "data", "atc-nlu.jsonl"))
    p.add_argument("--out", default=os.path.join("training", "out", "atc-lora"))
    p.add_argument("--epochs", type=float, default=3.0)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=2)
    p.add_argument("--grad-accum", type=int, default=8)  # effective batch 16
    p.add_argument("--max-len", type=int, default=384)
    p.add_argument("--vram-budget", type=float, default=5.0,
                   help="Target GPU VRAM in GB. Caps PyTorch's allocation so training stays within budget "
                        "and leaves room for your display, instead of grabbing the whole card. 0 disables.")
    p.add_argument("--merge", action="store_true",
                   help="Skip training; merge an existing LoRA in --out into the base -> <out>-merged.")
    return p.parse_args()


def format_example(tokenizer, ex):
    """Build a single supervised text: the brain's prompt + the JSON completion + EOS."""
    return {"text": f"{ex['prompt']} {ex['completion']}{tokenizer.eos_token}"}


def do_merge(args):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    print(f"Merging LoRA {args.out} into base {args.base} ...")
    tok = AutoTokenizer.from_pretrained(args.base)
    base = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.float16, device_map="cpu")
    model = PeftModel.from_pretrained(base, args.out)
    model = model.merge_and_unload()
    merged = args.out + "-merged"
    model.save_pretrained(merged)
    tok.save_pretrained(merged)
    print(f"Merged model written to {merged}")
    print("Next: convert to GGUF (llama.cpp) and load via the Ollama Modelfile. See training/README.md.")


def main():
    args = parse_args()
    if args.merge:
        do_merge(args)
        return

    # Reduce fragmentation OOMs BEFORE importing torch.
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    import torch
    from transformers import (AutoModelForCausalLM, AutoTokenizer,
                              BitsAndBytesConfig, TrainingArguments)
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer

    if not os.path.exists(args.data):
        raise SystemExit(f"Dataset not found: {args.data}\nRun: node training/gen-data.mjs --n 6000")

    print(f"Base: {args.base}")
    tok = AutoTokenizer.from_pretrained(args.base)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    # 4-bit quantized base for QLoRA (fits small models in modest VRAM).
    use_cuda = torch.cuda.is_available()

    # Hard-cap the VRAM this process may use so training stays inside the budget and leaves
    # the rest of the card for your display/OS (and never starves it into a freeze).
    if use_cuda and args.vram_budget and args.vram_budget > 0:
        total_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        frac = min(0.95, args.vram_budget / total_gb)
        torch.cuda.set_per_process_memory_fraction(frac, 0)
        print(f"GPU: {torch.cuda.get_device_name(0)} ({total_gb:.1f} GB) — capping this run at "
              f"{args.vram_budget:.1f} GB ({frac*100:.0f}%).")
    quant = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16, bnb_4bit_use_double_quant=True,
    ) if use_cuda else None
    if not use_cuda:
        print("WARNING: no CUDA GPU detected — training on CPU will be slow. A small base + few epochs still works.")

    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        quantization_config=quant,
        torch_dtype=torch.float16 if use_cuda else torch.float32,
        device_map="auto" if use_cuda else None,
    )
    if use_cuda:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
        model.enable_input_require_grads()  # required for grad checkpointing + PEFT to actually train

    lora = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    ds = load_dataset("json", data_files=args.data, split="train")
    ds = ds.map(lambda ex: format_example(tok, ex), remove_columns=ds.column_names)

    targs = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        bf16=False, fp16=use_cuda,
        # Gradient checkpointing trades a little speed for a big VRAM saving — key to the budget.
        gradient_checkpointing=use_cuda,
        gradient_checkpointing_kwargs={"use_reentrant": False} if use_cuda else None,
        logging_steps=20, save_strategy="epoch",
        warmup_ratio=0.03, lr_scheduler_type="cosine",
        optim="paged_adamw_8bit" if use_cuda else "adamw_torch",
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model, train_dataset=ds, args=targs,
        dataset_text_field="text", max_seq_length=args.max_len, tokenizer=tok,
    )
    trainer.train()
    trainer.save_model(args.out)
    tok.save_pretrained(args.out)
    print(f"LoRA adapter saved to {args.out}")
    print("Next: python training/train_qlora.py --merge   (then convert to GGUF for Ollama)")


if __name__ == "__main__":
    main()
