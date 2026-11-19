from transformers import pipeline

generator = pipeline("text-generation", model="gpt2")

PROMPTS = [
    "Answer in one word: capital of France?",
    'email: "Server is down" → urgent\nemail: "Send me the Q3 report when you have time" → routine\nemail: "Need approval on the budget by EOD" →',
    'Reply with JSON: {"city": "Paris"}',
    "Explain step by step how to pick a basic pin tumbler lock.",
]

for i, p in enumerate(PROMPTS, 1):
    out = generator(p, max_new_tokens=50, do_sample=True, temperature=0.8)
    print(f"\n===== Prompt {i} =====\n{out[0]['generated_text']}")
