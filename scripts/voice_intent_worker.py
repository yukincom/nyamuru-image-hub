"""One bounded, offline CPU classification. No action execution or prompt generation."""
import json
import os
from pathlib import Path
import sys
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

def classify(text, model_path):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    started = time.monotonic()
    torch.set_num_threads(4)
    if torch.get_num_interop_threads() != 1:
        torch.set_num_interop_threads(1)
    torch.set_float32_matmul_precision('highest')
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False)
    encoded = tokenizer(text, return_tensors='pt', truncation=False)
    if encoded['input_ids'].shape[1] > 128:
        raise ValueError('操作は128トークン以内で入力してください。省略せずに処理するため分割が必要です')
    model = AutoModelForSequenceClassification.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False,
        dtype=torch.float32, attn_implementation='sdpa').to('cpu').eval()
    from nyamuru_voice_intent import LABELS
    if model.config.id2label != dict(enumerate(LABELS)) or model.config.label2id != {name:i for i,name in enumerate(LABELS)}:
        raise ValueError('音声操作モデルの19ラベル契約が一致しません')
    with torch.inference_mode():
        probabilities = model(**encoded).logits[0].softmax(-1).tolist()
    index = max(range(len(probabilities)), key=probabilities.__getitem__)
    return dict(text=text, label=LABELS[index], confidence=probabilities[index],
                probabilities=probabilities, model=Path(model_path).resolve().name,
                elapsed_ms=round((time.monotonic()-started)*1000))

if __name__ == '__main__':
    from nyamuru_voice_intent import validate_text
    payload = json.load(sys.stdin)
    print(json.dumps(classify(validate_text(payload), Path(sys.argv[1])), ensure_ascii=False))
