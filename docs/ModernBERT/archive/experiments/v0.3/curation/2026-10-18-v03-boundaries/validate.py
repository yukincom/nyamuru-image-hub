"""Validate the data handoff with stdlib only; never load models or run training."""

import argparse
import hashlib
import json
import math
import re
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_lines(data):
    return [json.loads(line) for line in data.decode().splitlines() if line]


def normalize(text):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', text).casefold())


def check(condition, message):
    if not condition:
        raise ValueError(message)


def positive_int(value):
    return type(value) is int and value > 0


def validate(root, baseline_zip):
    manifest = json.loads((root / 'manifest.json').read_text())
    labels_bytes = (root / 'labels.json').read_bytes()
    labels = json.loads(labels_bytes)
    rows = load_lines((root / 'candidates.jsonl').read_bytes())
    links = json.loads((root / 'family-links.json').read_text())
    evidence = json.loads((root / 'regression-evidence.json').read_text())
    review = (root / 'review.md').read_text()
    check(len(rows) == manifest['row_count'] == 288, 'row count')
    check(labels['label2id'] == manifest['label2id'], 'label mapping')
    check(sorted(labels['label2id'].values()) == list(range(19)), 'label IDs')
    check(manifest['model_fields'] == ['text'] and manifest['target_field'] == 'label', 'input contract')
    check(manifest['allowed_splits'] == ['train'], 'train-only manifest')
    check(manifest['previous_corpus_rows'] == 924 and manifest['candidate_pool_rows'] == 1212, 'pool counts')
    check(manifest['acceptance']['target_accuracy'] == 0.95, 'requested target')
    check(not any(manifest[k] for k in ['training_run', 'model_inference_run', 'asr_run', 'runtime_wired']), 'execution provenance')
    check(manifest['servers_started'] == [], 'server provenance')
    for name, meta in manifest['files'].items():
        check((root / name).stat().st_size == meta['bytes'], f'file size: {name}')
        check(sha_file(root / name) == meta['sha256'], f'file hash: {name}')
    check(sha_file(baseline_zip) == manifest['previous_archive_sha256'] == evidence['archive_sha256'], 'baseline archive hash')
    with zipfile.ZipFile(baseline_zip) as z:
        check(z.read('source/labels.json') == labels_bytes, 'unchanged label contract bytes')
        original = [row for name in ['source/candidates.jsonl', 'curation/2026-10-17-v02-variants/candidates.jsonl'] for row in load_lines(z.read(name))]
        check(len(original) == 924, 'baseline corpus size')
        old = {row['id']: row for row in original}
        old_texts = {normalize(row['text']) for row in original}
        for name, digest in manifest['previous_inputs_sha256'].items():
            check(hashlib.sha256(z.read(name)).hexdigest() == digest, f'baseline input hash: {name}')
        lineage = {}
        for split in ['train', 'dev', 'test']:
            for pred in load_lines(z.read(f'reports/seed-42/{split}-predictions.jsonl')):
                lineage[pred['id']] = dict(id=pred['id'], text=pred['text'], label=pred['gold'],
                                           group=pred['group'], family=pred['family'], legacy_split=split)
        for name, digest in evidence['reference_files'].items():
            check(hashlib.sha256(z.read(name)).hexdigest() == digest, f'evidence file hash: {name}')
        errors = {}
        for seed in [42, 43, 44]:
            for pred in load_lines(z.read(f'reports/seed-{seed}/test-predictions.jsonl')):
                if pred['correct']:
                    continue
                record = errors.setdefault(pred['id'], {k: pred[k] for k in ['id', 'text', 'gold', 'group', 'family']})
                record.setdefault('incorrect_predictions', {})[f'seed-{seed}'] = {
                    k: pred[k] for k in ['predicted', 'confidence', 'probabilities']}
        check(evidence['errors'] == [errors[key] for key in sorted(errors)], 'verbatim legacy error records')
        check(evidence['unique_error_rows'] == len(errors) == 39, 'legacy error count')
        results = json.loads(z.read('reports/results.json'))
        for seed, metrics in evidence['models'].items():
            check(metrics == {key: results[seed]['test'][key] for key in metrics}, f'legacy metrics: {seed}')
    expected_ids = [f'nyamuru_voice_{i:03d}' for i in range(925, 1213)]
    check([r['id'] for r in rows] == expected_ids, 'unique sequential IDs')
    check(not set(expected_ids) & set(old), 'baseline ID collision')
    seen = set()
    routing_only = {'not_command', 'needs_clarification', 'needs_reasoning', 'compound_request', 'out_of_scope_request'}
    for row in rows:
        identifier, text, label, slots = (row[k] for k in ['id', 'text', 'label', 'slots'])
        check(type(text) is str and text.strip() == text and text and '\n' not in text, f'text: {identifier}')
        normalized = normalize(text)
        check(normalized not in seen and normalized not in old_texts, f'duplicate: {identifier}')
        seen.add(normalized)
        check(label in labels['label2id'], f'known label: {identifier}')
        check(row['source'] == 'codex_synthetic' and row['review_status'] == 'pending_user_review', f'provenance: {identifier}')
        check(row['allowed_split'] == 'train' and 'train_only' in row['tags'] and 'post_v02_test_review' in row['tags'], f'split: {identifier}')
        check(type(slots) is dict and isinstance(row['note'], str) and row['note'], f'annotations: {identifier}')
        check(review.count('| ' + identifier + ' |') == 1 and text in review, f'review coverage: {identifier}')
        check('context' not in row and 'predicted' not in row and 'confidence' not in row, f'no spurious model evidence: {identifier}')
        if label in routing_only:
            check(slots == {}, f'routing-only slots: {identifier}')
        else:
            check(bool(slots), f'action slots: {identifier}')
        if label in ['undo', 'redo']:
            check(set(slots) == {'count'} and positive_int(slots['count']), f'history slots: {identifier}')
        elif label == 'save':
            check(slots == {'target': 'current_document'}, f'save slots: {identifier}')
        elif label in ['panel_sync_set', 'inner_frame_snap_set', 'panel_gap_snap_set']:
            check(set(slots) == {'enabled'} and type(slots['enabled']) is bool, f'setting slots: {identifier}')
        elif label == 'paint_tool_set':
            check(set(slots) == {'tool'} and slots['tool'] in ['pen', 'vector-pen'], f'paint slots: {identifier}')
        elif label == 'generate_request':
            check(set(slots) == {'target'} and slots['target'] in labels['slot_contract']['generate_request']['target'], f'generation slots: {identifier}')
        elif label == 'text_frames_align':
            check(slots == {'target': 'selected_text_frames', 'alignment': 'top', 'reference': 'selection_bounds'}, f'alignment slots: {identifier}')
        elif label == 'page_navigate':
            if 'page_number' in slots:
                check(set(slots) == {'page_number'} and positive_int(slots['page_number']), f'page number: {identifier}')
            else:
                check(set(slots) == {'direction', 'count'} and slots['direction'] in ['next', 'previous'] and positive_int(slots['count']), f'page direction: {identifier}')
        elif label == 'bubble_set':
            check(slots['target'] == 'selected_bubble' and slots['field'] in ['shape', 'tail_enabled', 'text', 'bbox'], f'bubble field: {identifier}')
            if slots['field'] == 'text':
                check(slots['value'] in re.findall('「([^」]*)」', text), f'quoted text preserved: {identifier}')
            elif slots['field'] == 'shape':
                check(slots['value'] in ['normal', 'square', 'caption'], f'shape: {identifier}')
            elif slots['field'] == 'tail_enabled':
                check(type(slots['value']) is bool, f'tail value: {identifier}')
            elif slots['field'] == 'bbox':
                keys = ['dx_mm', 'dy_mm'] if slots['operation'] == 'translate' else ['width_mm', 'height_mm']
                check(slots['operation'] in ['translate', 'resize'], f'bbox operation: {identifier}')
                check(all(type(slots[key]) in [int, float] and math.isfinite(slots[key]) for key in keys), f'bbox units: {identifier}')
                if slots['operation'] == 'resize':
                    check(all(slots[key] > 0 for key in keys), f'bbox positive size: {identifier}')
    check(dict(Counter(r['label'] for r in rows)) == manifest['counts'], 'label counts')
    check(dict(Counter(r['focus'] for r in rows)) == manifest['focus_counts'] == {'negation_defer': 96, 'undo_redo': 96, 'compound_boundary': 96}, 'focus counts')
    check(set(Counter(r['group'] for r in rows).values()) == {8}, 'eight rows per contrast group')
    check(len(links['groups']) == manifest['group_count'] == 36, 'group links')
    check(len({r['family'] for r in rows}) == links['family_count'] == manifest['family_count'], 'family count')
    check(links['legacy_holdout_retired_for_acceptance'] is True, 'legacy holdout status')
    linked_ids = []
    for link in links['groups']:
        members = [r for r in rows if r['group'] == link['group']]
        check(link['candidate_ids'] == [r['id'] for r in members], 'link members')
        check(all(r['family'] == link['family'] and r['focus'] == link['focus'] for r in members), 'family membership')
        linked_ids.extend(link['candidate_ids'])
        check(all(anchor == lineage[anchor['id']] for anchor in link['v02_anchors']), 'exact legacy anchor metadata')
        expected = {r['id'] for r in lineage.values() if r['group'] in link['related_v02_groups']}
        check(expected == {r['id'] for r in link['v02_anchors']}, 'complete anchor groups')
    check(linked_ids == expected_ids, 'all rows linked once')
    check(not evidence['eligible_for_new_holdout'] and evidence['role'] == 'legacy_regression_diagnostic_only', 'evidence role')
    return dict(status='passed', rows_checked=len(rows), groups_checked=len(links['groups']),
                families_checked=links['family_count'], unique_ids=True, normalized_duplicates_with_v02=0,
                normalized_duplicates_within_new=0, labels_unchanged_byte_for_byte=True,
                label_and_slot_checks=True, review_coverage=288, lineage_verified=True,
                legacy_error_rows_verified=39, original_archive_hash_verified=True,
                source='stdlib artifact validation; no learned-model inference',
                semantic_review=manifest['semantic_review'], training_run=False, model_inference_run=False,
                input_files_sha256={n: sha_file(root / n) for n in ['candidates.jsonl', 'labels.json', 'family-links.json', 'regression-evidence.json', 'review.md', 'README.md', 'manifest.json', 'validate.py']})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-zip', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    baseline = args.baseline_zip or Path(json.loads((root / 'manifest.json').read_text())['previous_archive'])
    result = validate(root, baseline)
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(encoded)
    print(encoded)
