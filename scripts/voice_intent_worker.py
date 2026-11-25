"""One bounded, offline CPU classification. No action execution or prompt generation."""
import json
import os
from pathlib import Path
import sys
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

# 旧->新: 旧=SequenceClassification単体推論のみ -> 新=slot_id2label保持モデルでM5意図分類＋BIOスロット抽出を同時推論(v04互換維持)
def classify(text, model_path):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    from nyamuru_voice_intent import LABELS
    from voice_command_slots import extract_command_slots_from_bio

    started = time.monotonic()
    torch.set_num_threads(4)
    if torch.get_num_interop_threads() != 1:
        torch.set_num_interop_threads(1)
    torch.set_float32_matmul_precision('highest')
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False)
    encoded = tokenizer(
        text, return_tensors='pt', truncation=False,
        return_offsets_mapping=bool(getattr(tokenizer, 'is_fast', False)),
    )
    offsets = [(int(s), int(e)) for s, e in encoded.pop('offset_mapping')[0].tolist()] if 'offset_mapping' in encoded else []
    if encoded['input_ids'].shape[1] > 128:
        raise ValueError('操作は128トークン以内で入力してください。省略せずに処理するため分割が必要です')
    model = AutoModelForSequenceClassification.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False,
        dtype=torch.float32, attn_implementation='sdpa').to('cpu').eval()
    if model.config.id2label != dict(enumerate(LABELS)) or model.config.label2id != {name:i for i,name in enumerate(LABELS)}:
        raise ValueError('音声操作モデルの19ラベル契約が一致しません')
    with torch.inference_mode():
        outputs = model(**encoded)
        raw_logits = getattr(outputs, 'logits', outputs[0])
        probabilities = raw_logits[0].softmax(-1).tolist()
        slots = []
        raw_slot_logits = getattr(outputs, 'slot_logits', None)
        raw_slot_map = getattr(model.config, 'slot_id2label', None)
        if raw_slot_logits is not None and isinstance(raw_slot_map, dict) and offsets:
            id2slot = {int(k): str(v) for k, v in raw_slot_map.items()}
            slot_probs = raw_slot_logits[0].softmax(-1)
            slot_scores, slot_ids = slot_probs.max(dim=-1)
            slots = extract_command_slots_from_bio(
                text, offsets, slot_ids.tolist(), slot_scores.tolist(), id2slot,
            )
    index = max(range(len(probabilities)), key=probabilities.__getitem__)
    return dict(text=text, label=LABELS[index], confidence=probabilities[index],
                probabilities=probabilities, slots=slots,
                model=Path(model_path).resolve().name,
                elapsed_ms=round((time.monotonic()-started)*1000))

if __name__ == '__main__':
    from nyamuru_voice_intent import validate_text
    payload = json.load(sys.stdin)
    print(json.dumps(classify(validate_text(payload), Path(sys.argv[1])), ensure_ascii=False))
