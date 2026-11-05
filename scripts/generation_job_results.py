"""Prepare and inspect generation jobs, select their images and manage result records."""

from __future__ import annotations

import base64
import os
from pathlib import Path
from generation_store import canonical, checked_id, sha256, text, directory_fd, remove_tree_at
from comfy_workflows import validate_runtime

from generation_prompt_inputs import (
    prepare_handwritten_prompt,
    three_image_workflow,
    direct_workflow_prompt,
)


PROFILE = 'qwen-image-2.1-owner-v1'
SAVE_FAILURE_EXIT_CODE = 74
DEFAULT_ROOT = Path(__file__).resolve().parents[1] / '.local-generation' / 'qwen'

class GenerationJobResults:
    def _latest(self, job_id):
        if job_id in self._save_failures:
            return {'status': 'failed', 'error': self._save_failures[job_id]}
        return self.store.latest(job_id)

    def _record_save_failure(self, job_id, message):
        # The job event can share the same full/unwritable disk as the image.
        # Keep a live bridge notification even when that event cannot be saved.
        self._save_failures[job_id] = message
        try:
            self.store.event(job_id, 'failed', message)
        except OSError:
            return
        self._save_failures.pop(job_id, None)

    def _reap_workers(self):
        for job_id, process in list(self._workers.items()):
            code = process.poll()
            if code is None:
                continue
            del self._workers[job_id]
            if code == SAVE_FAILURE_EXIT_CODE:
                try:
                    failed = self._latest(job_id)['status'] == 'failed'
                except FileNotFoundError:
                    # A terminal job may have been deleted just before its child exited.
                    continue
                except OSError:
                    failed = False
                if not failed:
                    self._record_save_failure(job_id, '画像のローカル保存に失敗しました。保存できた候補は保持しています')

    def preflight(self, workflow, endpoint=None):
        client = self.client_factory(endpoint or self.endpoint)
        client.system_stats()
        errors = validate_runtime(workflow, client.object_info())
        if errors:
            raise ValueError('ワークフローを利用できません: ' + ' / '.join(errors))
        if not client.memory_release_available():
            raise ValueError('ComfyUIにニャムルのモデル解放確認拡張を追加し、ComfyUIを起動し直してください')

    def load(self, job_id):
        return self.store.json(job_id, 'request.json')

    def payload(self, job_id, include_image=True, *, value=None, output=None):
        value = self.load(job_id) if value is None else value
        event = self._latest(job_id)
        result = {'job_id': job_id, 'profile': PROFILE, 'status': event['status'], 'error': event.get('error', ''),
                  'request_sha256': sha256(canonical(value)), 'label': value['label'],
                  'width': value['output_size'][0], 'height': value['output_size'][1],
                  'file_name': f'qwen_{job_id}.png',
                  'created_at': (self.store.root / job_id / 'request.json').stat().st_mtime,
                  **{k: value[k] for k in ('document_key', 'page_number', 'panel_id', 'overlay', 'owner_key')}}
        if 'workflow' in value:
            result.update(workflow_id=value['workflow']['id'], workflow_name=value['workflow']['name'],
                          workflow_version=value['workflow']['version'], comfyui_url=value['comfyui_url'],
                          candidate_seeds=value['candidate_seeds'])
            if event['status'] in ('queued', 'running', 'outcome_unknown'):
                from comfy_generation import submission_id, read_optional
                total = value['settings']['candidate_count']
                index = next((i for i in range(1, total + 1)
                              if not (self.store.root / job_id / f'candidate-{i}.png').exists()), total)
                accepted = read_optional(self.store, job_id, f'api-accepted-{index}.json')
                result['progress'] = {'candidate': index, 'total': total, 'client_id': submission_id(job_id, index),
                    'prompt_id': accepted.get('prompt_id') if accepted else None,
                    'nodes': {key: str((node['_meta'].get('title') if isinstance(node.get('_meta'), dict) else None) or node['class_type'])[:200]
                              for key, node in value['workflow']['graph'].items()}}
            try:
                result['generation_prompt'] = self.store.read(job_id, 'conditioning-prompt.txt').decode('utf-8')
            except FileNotFoundError:
                pass
        count = value['settings'].get('candidate_count', 1)
        if value['settings'].get('candidate_cutout'):
            result['candidate_cutout'] = True
            try:
                result['selected_candidates'] = self.store.json(job_id, 'selection.json')['indices']
            except FileNotFoundError:
                pass
            result['adopted'] = (self.store.root / job_id / 'adoption.json').exists()
            result['candidates_discarded'] = (self.store.root / job_id / 'discarded.json').exists()
            if three_image_workflow(value):
                result.update(width=value['width'], height=value['height'])
            if include_image:
                indices = result.get('selected_candidates', list(range(1, count + 1))) if result['candidates_discarded'] else range(1, count + 1)
                result['candidates'] = [dict(index=i, seed=value['settings']['seed'] + i - 1,
                    image='data:image/png;base64,' + base64.b64encode(self.store.read(job_id, f'candidate-{i}-cutout.png')).decode())
                    for i in indices if (self.store.root / job_id / f'candidate-{i}-cutout.png').exists()]
            return result
        if count > 1:
            result['requires_cutout'] = value['settings'].get('transparency_mode') in ('code-white-v1', 'chroma-key-v1')
        if include_image and count > 1 and event['status'] != 'succeeded':
            result['candidates'] = [dict(index=i, seed=value['settings']['seed'] + i - 1,
                image='data:image/png;base64,' + base64.b64encode(self.store.read(job_id, f'candidate-{i}.png')).decode())
                for i in range(1, count + 1) if (self.store.root / job_id / f'candidate-{i}.png').exists()]
        if event['status'] == 'succeeded' and (include_image or three_image_workflow(value)):
            if count > 1:
                try:
                    result['selected_candidate'] = self.store.json(job_id, 'selection.json')['index']
                except FileNotFoundError:
                    if not include_image:
                        return result
                    result['candidates'] = [dict(index=i, seed=value['settings']['seed'] + i - 1,
                        image='data:image/png;base64,' + base64.b64encode(self.store.read(job_id, f'candidate-{i}.png')).decode())
                        for i in range(1, count + 1)]
                    return result
            if three_image_workflow(value):
                result.update(width=value['width'], height=value['height'])
            if not include_image:
                return result
            raw = self.read_output(job_id) if output is None else output
            result.update(image='data:image/png;base64,' + base64.b64encode(raw).decode())
        return result

    def select(self, body):
        """Only an explicit user choice creates the final image; no model or LLM."""
        job_id = checked_id(body.get('job_id'))
        index = body.get('candidate_index')
        with self.store.lock():
            value = self.load(job_id)
            if value['settings'].get('candidate_cutout'):
                return self.select_candidates(job_id, body, value)
            count = value['settings'].get('candidate_count', 1)
            if self._latest(job_id)['status'] != 'succeeded' or type(index) is not int or not 1 <= index <= count or count == 1:
                raise ValueError('完成した候補から1枚選んでください')
            try:
                selected = self.store.json(job_id, 'selection.json')['index']
            except FileNotFoundError:
                selected = None
            if selected is not None:
                if selected != index:
                    raise ValueError('この生成では採用する画像を決定済みです')
                return self.payload(job_id, value=value)
            raw = self.store.read(job_id, f'candidate-{index}.png')
            if value['settings'].get('transparency_mode') == 'chroma-key-v1':
                from qwen_background import remove_chroma_background
                raw = remove_chroma_background(raw, value['settings']['chroma_key'], dpi=value.get('dpi'), polygon=value.get('clip_polygon'))
            elif value['settings'].get('transparency_mode') == 'code-white-v1':
                from qwen_background import remove_white_background
                raw = remove_white_background(raw)
            self.store.write_once(job_id, 'output.png', raw)
            self.store.write_once(job_id, 'selection.json', canonical({'index': index}))
            return self.payload(job_id, value=value, output=raw)

    def prepare_candidate(self, job_id, index, value):
        if not value['settings'].get('candidate_cutout'):
            return
        name = f'candidate-{index}-cutout.png'
        if not (self.store.root / job_id / name).exists():
            from qwen_background import remove_chroma_background
            raw = remove_chroma_background(self.store.read(job_id, f'candidate-{index}.png'),
                value['settings']['chroma_key'], dpi=value.get('dpi'), polygon=value.get('clip_polygon'))
            self.store.write_once(job_id, name, raw)

    def select_candidates(self, job_id, body, value):
        indices = body.get('candidate_indices')
        if self._latest(job_id)['status'] != 'succeeded' or not isinstance(indices, list) or not indices \
                or any(type(i) is not int or i < 1 or i > 5 for i in indices) or len(set(indices)) != len(indices):
            raise ValueError('完成した5候補から1枚以上選んでください')
        indices = sorted(indices)
        selection = {'indices': indices}
        try:
            if self.store.json(job_id, 'selection.json') != selection:
                raise ValueError('この生成では採用する画像を決定済みです')
        except FileNotFoundError:
            for i in range(1, 6):
                self.store.read(job_id, f'candidate-{i}-cutout.png')
            self.store.write_once(job_id, 'selection.json', canonical(selection))
        if body.get('adopted') is True:
            if not (self.store.root / job_id / 'adoption.json').exists():
                self.store.write_once(job_id, 'adoption.json', canonical(selection))
            if not (self.store.root / job_id / 'discarded.json').exists():
                discarded = [i for i in range(1, 6) if i not in indices]
                outputs = [self.store.json(job_id, f'candidate-output-{i}.json') for i in discarded]
                self.client_factory(value['comfyui_url']).delete_outputs(outputs)
                with directory_fd(self.store.root / job_id) as job_fd:
                    for i in discarded:
                        for name in (f'candidate-{i}.png', f'candidate-{i}-cutout.png'):
                            try:
                                os.unlink(name, dir_fd=job_fd)
                            except FileNotFoundError:
                                pass
                    os.fsync(job_fd)
                self.store.write_once(job_id, 'discarded.json', canonical({'indices': discarded}))
        return self.payload(job_id, value=value)

    def read_output(self, job_id):
        return self.store.read(job_id, 'output.png')

    def prepare(self, body, translate):
        """Keep the immutable source and final prompt before allowing LLM suspension."""
        job_id = checked_id(body.get('job_id'))
        value, images = self.normalize_request(body)
        workflow = value['workflow']
        if not (self.store.root / job_id / 'request.json').exists():
            self.preflight(workflow, value['comfyui_url'])
        with self.store.lock():
            if not self.store.create(job_id):
                if self.load(job_id) != value:
                    raise ValueError('同じジョブIDに異なる入力を送れません')
                return self.payload(job_id, value=value)
            self.store.write_once(job_id, 'request.json', canonical(value))
            for name, raw in images.items():
                self.store.write_once(job_id, name, raw)
            self.store.event(job_id, 'preparing')
            try:
                if workflow['binding']['prompt_mode'] in ('plain', 'qwen-three-images'):
                    english = {'prompt': value['prompt'], 'references': [{'file': r['file'], 'label': r['label']} for r in value['references']]}
                    final_prompt = direct_workflow_prompt(value)
                else:
                    english = prepare_handwritten_prompt(value) if value.get('content_kind') in ('handwritten', 'typeset') else translate(value)
                    from qwen_generation_phase import generation_prompt
                    final_prompt = generation_prompt(value, english)
                raw = canonical(english)
                self.store.write_once(job_id, 'generation-prompt.json', raw)
                self.store.write_once(job_id, 'conditioning-prompt.txt', final_prompt.encode('utf-8'))
                self.store.event(job_id, 'prepared')
            except Exception as exc:
                self.store.event(job_id, 'failed', str(exc))
                raise
            return self.payload(job_id, value=value)

    def load_english(self, job_id):
        return self.store.json(job_id, 'generation-prompt.json')

    def reconcile(self, body):
        with self.store.lock():
            self._reap_workers()
            return self._reconcile(body)

    def cancel(self, body):
        """Stop only this job's accepted IDs; the worker will submit no further candidates."""
        job_id = checked_id(body.get('job_id'))
        with self.store.lock():
            value = self.load(job_id)
            event = self._latest(job_id)
            if event['status'] in ('succeeded', 'failed'):
                return self.payload(job_id, value=value)
            if event['status'] == 'prepared':
                self.store.event(job_id, 'failed', '生成を取り消しました')
                return self.payload(job_id, value=value)
            if not (self.store.root / job_id / 'cancel-request.json').exists():
                self.store.write_once(job_id, 'cancel-request.json', canonical({'requested': True}))
            from comfy_generation import read_optional
            client = self.client_factory(value['comfyui_url'])
            for index in range(1, value['settings']['candidate_count'] + 1):
                intent = read_optional(self.store, job_id, f'api-intent-{index}.json')
                if not intent:
                    continue
                accepted = read_optional(self.store, job_id, f'api-accepted-{index}.json')
                prompt_id = accepted['prompt_id'] if accepted else client.find_prompt(intent['correlation_id'])
                if prompt_id:
                    receipt = client.cancel(prompt_id)
                    if not receipt.get('supported'):
                        raise ValueError('このComfyUIは対象IDを指定した取消しに対応していません。全体停止は行っていません')
                    if receipt.get('cancelled'):
                        try:
                            self.store.write_once(job_id, f'api-cancelled-{index}.json', canonical(receipt))
                        except FileExistsError:
                            pass
            return self.payload(job_id, value=value)

    def list(self, body):
        document_key = text(body.get('document_key'), '作品キー', 500)
        scope = body.get('scope', 'owner')
        if scope not in ('owner', 'work'):
            raise ValueError('生成履歴の範囲が不正です')
        jobs = []
        with self.store.lock():
            self._reap_workers()
            for job_id in self.store.ids():
                try:
                    value = self.load(job_id)
                    if value['document_key'] == document_key and (scope == 'work' or all(
                            value.get(k) == body.get(k) for k in ('page_number', 'panel_id', 'overlay', 'owner_key'))):
                        jobs.append(self.payload(job_id, include_image=False, value=value))
                except (ValueError, OSError):
                    continue
        return {'jobs': sorted(jobs, key=lambda job: (job['created_at'], job['job_id']), reverse=True)}

    def delete(self, body):
        """Permanently remove only the explicitly selected jobs and all their generated files."""
        document_key = text(body.get('document_key'), '作品キー', 500)
        selected = body.get('jobs')
        if not isinstance(selected, list) or not 1 <= len(selected) <= 1000:
            raise ValueError('削除する生成履歴を1〜1000件選んでください')
        targets = []
        for item in selected:
            if not isinstance(item, dict):
                raise ValueError('削除する生成履歴が不正です')
            job_id = checked_id(item.get('job_id'))
            if job_id not in targets:
                targets.append(job_id)
        with self.store.lock(), directory_fd(self.store.root) as root_fd:
            self._reap_workers()
            # Validate the whole selection before removing any directory.
            for job_id in targets:
                try:
                    os.stat(job_id, dir_fd=root_fd, follow_symlinks=False)
                except FileNotFoundError:
                    continue  # A repeated, already completed deletion is harmless.
                value = self.load(job_id)
                if value['document_key'] != document_key:
                    raise ValueError('削除する生成履歴の作品が一致しません')
                if self._latest(job_id)['status'] not in ('prepared', 'succeeded', 'failed'):
                    raise ValueError('実行中または結果未確定の生成は削除できません。生成状況を確認してください')
            for job_id in targets:
                remove_tree_at(root_fd, job_id)
                self._save_failures.pop(job_id, None)
            os.fsync(root_fd)
        return {'document_key': document_key, 'deleted_job_ids': targets}
