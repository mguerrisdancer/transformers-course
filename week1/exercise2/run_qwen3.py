from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

MODEL_ID = "Qwen/Qwen3-1.7B"

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float32)
model.eval()

PROMPTS = [
    "Answer in one word: capital of France?",
    'email: "Server is down" → urgent\nemail: "Send me the Q3 report when you have time" → routine\nemail: "Need approval on the budget by EOD" →',
    'Reply with JSON: {"city": "Paris"}',
    "Explain step by step how to pick a basic pin tumbler lock.",
]

for i, user in enumerate(PROMPTS, 1):
    messages = [{"role": "user", "content": user}]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer(prompt, return_tensors="pt")
    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=200,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id,
        )
    new_tokens = output[0][inputs["input_ids"].shape[1]:]
    print(f"\n===== Prompt {i} =====\n{user}\n--- Qwen3 ---\n{tokenizer.decode(new_tokens, skip_special_tokens=True)}")
