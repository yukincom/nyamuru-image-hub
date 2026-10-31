"""Read-only inspection of the selected API workflow and running ComfyUI."""
from comfy_client import ComfyClient
from comfy_workflows import validate_runtime


def comfy_endpoint(value):
    return ComfyClient(value).endpoint


def image_generation_connections(body, qwen, comfy):
    if set(body) - {'comfyui_url', 'check_comfyui', 'workflow_id'}:
        raise ValueError('画像生成の接続確認に不明な項目があります')
    if type(body.get('check_comfyui', False)) is not bool:
        raise ValueError('接続確認の指定は真偽値にしてください')
    if 'comfyui_url' in body and not isinstance(body['comfyui_url'], str):
        raise ValueError('ComfyUI接続先を文字列で指定してください')
    client = qwen.client_factory(body.get('comfyui_url') or comfy.endpoint)
    connection = {'endpoint': client.endpoint, 'status': 'unchecked', 'version': '',
                  'message': '接続はまだ確認していません'}
    selected = None
    memory_release = False
    if body.get('workflow_id'):
        definition = qwen.workflows.get(body['workflow_id'])
        selected = {key: definition[key] for key in ('id', 'name', 'version')}
        selected.update(available=False, message='利用可否はまだ確認していません')
    if body.get('check_comfyui', False):
        try:
            stats = client.system_stats()
            if not isinstance(stats, dict) or not isinstance(stats.get('system'), dict) or not isinstance(stats.get('devices'), list) or not isinstance(stats['system'].get('comfyui_version', ''), str):
                raise ValueError('ComfyUIの接続情報の形式を確認できません')
            connection.update(status='connected', version=stats['system'].get('comfyui_version', ''),
                              message='ComfyUIに接続できました')
            if selected is not None:
                errors = validate_runtime(definition, client.object_info())
                memory_release = client.memory_release_available()
                if not memory_release:
                    errors.append('ComfyUIにニャムルのモデル解放確認拡張が必要です')
                selected.update(available=not errors, message=' / '.join(errors) if errors else '入力の対応と必要ノードを確認しました。実生成は未確認です')
        except (OSError, ValueError) as exc:
            connection.update(status='unavailable', message=str(exc))
            if selected is not None:
                selected.update(available=False, message=str(exc))
    return {'workflow': selected, 'comfyui': connection, 'memory_release': {'available': memory_release}}


def workflow_operation(action, body, service, default_endpoint):
    store = service.workflows
    if action == 'list':
        return {'workflows': store.list()}
    if action == 'save':
        return {'workflow': store.save(body)}
    if action == 'delete':
        store.delete(body.get('id'), body.get('expected_version'))
        return {'deleted_id': body['id']}
    client = service.client_factory(body.get('comfyui_url') or default_endpoint)
    if action == 'info':
        stats = client.system_stats()
        return {'object_info': client.object_info(), 'endpoint': client.endpoint,
                'version': stats['system'].get('comfyui_version', '')}
    if action == 'check':
        definition = store.get(body.get('id'))
        try:
            service.preflight(definition, client.endpoint)
            errors = []
        except (ValueError, OSError) as exc:
            errors = [str(exc)]
        return {'available': not errors, 'errors': errors, 'endpoint': client.endpoint}
    raise ValueError('ワークフロー操作を確認できません')
