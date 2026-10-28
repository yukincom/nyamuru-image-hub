"""One isolated Qwen phase using the existing lab runtime. No downloads or servers."""
import json
import os
from pathlib import Path
import sys
import threading
import time

ALPHA_PROMPT = (
    'This is an RGBA image with transparency. Extract the single person from this illustration. '
    'Remove only the plain white background, including background visible between the limbs. '
    'Preserve the exact silhouette, position, size, pose, face, hands, hair, clothing, linework and framing of the person. '
    'Keep white clothing and skin opaque. Do not redraw, reposition or add anything. '
    'The image has alpha channel and the background is transparent.')


def save_pixels(pixels, path):
    from PIL import Image
    Image.fromarray((pixels.cpu().numpy().clip(0, 1)*255).round().astype('uint8')).save(path)


def generation_prompt(config, english):
    if any(ref['role'] == 'canvas' for ref in config['references']):
        raise ValueError('自動追加の空画像を含む生成入力です。新しい生成を準備してください')
    roles = []
    multiple = len(config['references']) > 1
    correction = next((i for i, ref in enumerate(config['references'], 1) if ref['role'] == 'correction'), None)
    source = next((i for i, ref in enumerate(config['references'], 1) if ref['role'] in ('paint', 'sketch')), None)
    def image_name(index):
        return f'<image{index}>' if multiple else 'the supplied image'
    for i, ref in enumerate(config['references'], 1):
        if ref['role'] in ('paint', 'sketch'):
            if correction:
                roles.append(f'{image_name(i)}: the source image and canvas whose composition and untargeted content stay unchanged.')
            continue
        if ref['role'] == 'correction':
            roles.append(f'{image_name(i)}: ' + (
                f'drawn annotations or a separate mask locating the requested local edits on {image_name(source)}.' if source else
                'the annotated input image and canvas. Its marks and written instructions identify the requested local edits.'))
            continue
        name = f'<image{i}>' if multiple else 'The reference image'
        assignment = ''
        if config['owner_key'] in ('page', 'panel') and ref['character_keys']:
            characters = ', '.join(f'Character {config["character_keys"].index(key) + 1}' for key in ref['character_keys'])
            assignment = f'Assigned characters: {characters}. '
        roles.append(f"{name}: {english['references'][i-1]['label']}. {assignment}" +
                     ('Character identities and drawing styles.' if len(ref['character_keys']) > 1 else
                      'Character identity and drawing style; alternate views are one person, not extra people.'
                      if ref['character_keys'] else 'Drawing reference.'))
    if correction:
        instruction = (f'Edit {image_name(source or correction)} only as requested in the indicated regions. '
                       'Preserve the composition and all untargeted content. Remove the edit-guide marks and instruction text from the finished image.')
    elif config['mode'] == 'sketch':
        # The reviewed, editable storyboard prompt already contains the image roles.
        # Avoid a second competing editing instruction before the translated prompt.
        instruction = ''
        roles = []
    elif config['mode'] == 'paint':
        target = '<image1>' if multiple else 'the supplied painted image'
        instruction = f'Edit {target}. Preserve its pose and composition while completing the requested drawing.'
    else:
        instruction = ('Create a new drawing with the requested composition. Use the supplied images as references for the requested subject and style.'
                       if config['references'] else 'Create a new drawing with the requested composition.')
    prompt = ' '.join([instruction, *roles, english['prompt']])
    if not ((config['owner_key'] in ('page', 'panel') or config.get('content_kind') == 'handwritten') and config.get('literal_text')):
        prompt = ' '.join(prompt.split())
    if config['mode'] == 'sketch' and config['settings'].get('transparency_mode') == 'alpha-pass-v1':
        prompt += ' Use a plain white background for this finished illustration.'
    elif config['owner_key'] not in ('page', 'panel', 'background'):
        # Qwen's documented transparent-output format, independent of image inputs.
        prompt = 'This is an RGBA image with transparency. ' + prompt + ' The image has alpha channel and the background is transparent.'
    return prompt


def encode(config, english, directory, clip, vae, *, alpha_pass=False):
    """Keep reference images separate from the output latent's dimensions."""
    import numpy as np
    import torch
    from PIL import Image
    import nodes
    from comfy_extras.nodes_qwen import TextEncodeQwenImage21

    prompt = ALPHA_PROMPT if alpha_pass else generation_prompt(config, english)
    images = {}
    references = [{'file': 'render.png'}] if alpha_pass else config['references']
    for i, ref in enumerate(references, 1):
        with Image.open(directory / ref['file']) as image:
            images[f'image_{i}'] = torch.from_numpy(np.asarray(image.convert('RGBA'), dtype=np.float32) / 255).unsqueeze(0)
    positive, negative, latent = TextEncodeQwenImage21.execute(
        clip=clip, prompt=prompt,
        negative_prompt='', vae=vae, resolution=0 if alpha_pass else config['settings']['resolution'], images=images).result
    if config['mode'] == 'new':
        # Same path as the official edit template's custom_size switch. This is
        # the sampler's output latent, never an extra image for CLIP or the VAE.
        width, height = config['output_size']
        latent = nodes.EmptyLatentImage().generate(width, height)[0]
    return {'positive': positive, 'negative': negative, 'latent': latent}


def configure_sampling_model(model):
    """Use Comfy's model-local SDPA and lossless CPU reference-cache settings.

    Both default MPS attention sizing and automatic cache placement use system
    RAM, ignoring this worker's stricter MPS allocation limit.
    """
    from comfy.ldm.modules.attention import get_attention_function
    model.set_model_optimized_attention(get_attention_function('pytorch'))
    # Same option as the installed QwenImage21Cache node. Explicit CPU storage
    # remains safe when the normal UI suspends its LLM and frees system RAM.
    model.model_options['transformer_options']['qwen_image21_cache'] = {'device': 'cpu', 'dtype': 'default'}


def main():
    phase, directory, lab, lease_fd, token = sys.argv[1:]
    from image_generation_lock import validate_generation_fd
    from qwen_generation import QwenGenerationService
    validate_generation_fd(token, int(lease_fd))
    directory, lab = Path(directory), Path(lab)
    service = QwenGenerationService(directory.parent, lab)
    config = service.load(directory.name)
    english = service.load_english(directory.name)
    settings = config['settings']
    alpha_pass = phase.startswith('alpha-')
    operation = phase.removeprefix('alpha-')
    prefix = 'alpha-' if alpha_pass else ''
    if alpha_pass and settings.get('transparency_mode') != 'alpha-pass-v1':
        raise ValueError('このジョブに背景透過の追加工程はありません')
    import psutil
    minimum_start = settings.get('minimum_start_available_gib', 0) * 2**30
    # Allow the preceding process's memory to settle before refusing this phase.
    for attempt in range(5):
        if psutil.virtual_memory().available >= minimum_start:
            break
        if attempt == 4:
            print('画像生成に必要な空きメモリがありません。他のモデルの処理が終わってから実行してください', flush=True)
            raise SystemExit(75)
        time.sleep(5)
    baseline_swap = psutil.swap_memory().used
    os.environ.update(HF_HOME=str(lab / 'cache/huggingface'), HF_HUB_OFFLINE='1',
                      HF_HUB_DISABLE_TELEMETRY='1', TRANSFORMERS_OFFLINE='1')
    sys.path.insert(0, str(lab / 'runtime/ComfyUI'))
    sys.argv = [sys.argv[0]]
    import torch
    if settings.get('mps_limit_gib'):
        torch.mps.set_per_process_memory_fraction(settings['mps_limit_gib'] * 2**30 / torch.mps.recommended_max_memory())
    import comfy.model_management
    import comfy.sd
    import comfy.utils
    import nodes

    if not torch.backends.mps.is_available():
        raise RuntimeError('Qwen requires macOS MPS access')
    models = lab / 'models'

    def cpu_tree(value):
        if isinstance(value, torch.Tensor): return value.detach().cpu().clone()
        if isinstance(value, dict): return {k: cpu_tree(v) for k, v in value.items()}
        if isinstance(value, list): return [cpu_tree(v) for v in value]
        if isinstance(value, tuple): return tuple(cpu_tree(v) for v in value)
        return value

    def vae():
        state, metadata = comfy.utils.load_torch_file(str(models / 'vae/qwen_image_2.1_vae_bf16.safetensors'), return_metadata=True)
        # CPU avoids the installed runtime's MPS 5D-padding corruption.
        return comfy.sd.VAE(sd=state, metadata=metadata, device=torch.device('cpu'))

    stop = threading.Event()
    def monitor():
        process = psutil.Process()
        with (directory / f'{phase}-resources.jsonl').open('x') as log:
            while not stop.wait(1):
                available, swap = psutil.virtual_memory().available, psutil.swap_memory().used
                log.write(json.dumps({'time': time.time(), 'rss_bytes': process.memory_info().rss,
                  'cpu_percent': process.cpu_percent(), 'system_cpu_percent': psutil.cpu_percent(),
                  'available_bytes': available, 'swap_bytes': swap,
                  'mps_allocated_bytes': torch.mps.current_allocated_memory(), 'mps_driver_bytes': torch.mps.driver_allocated_memory()})+'\n')
                log.flush()
                if (available < settings.get('minimum_available_gib', 0) * 2**30
                        or swap - baseline_swap > settings.get('maximum_swap_increase_gib', float('inf')) * 2**30):
                    print('画像生成のメモリ上限に達したため、この生成処理を停止しました', flush=True)
                    # Exit only this isolated model process; the parent records failure.
                    os._exit(75)
    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    try:
        with torch.inference_mode():
            if operation == 'encode':
                (directory / f'{prefix}conditioning-prompt.txt').write_text(ALPHA_PROMPT if alpha_pass else generation_prompt(config, english), encoding='utf-8')
                clip = comfy.sd.load_clip([str(models / 'text_encoders/qwen3vl_8b_int8_convrot.safetensors')], clip_type=comfy.sd.CLIPType.QWEN_IMAGE)
                conditioning = encode(config, english, directory, clip, vae(), alpha_pass=alpha_pass)
                torch.save(cpu_tree(conditioning), directory / f'{prefix}conditioning.pt')
            elif operation == 'sample':
                model = comfy.sd.load_diffusion_model(str(models / 'diffusion_models' / settings['diffusion_model']))
                configure_sampling_model(model)
                (directory / f'{phase}-attention.json').write_text(json.dumps({
                    'backend': 'pytorch', 'torch_version': torch.__version__,
                    'scope': 'model-local dense attention',
                    'reference_cache': model.model_options['transformer_options']['qwen_image21_cache'],
                    'mps_limit_gib': settings.get('mps_limit_gib'),
                }), encoding='utf-8')
                data = torch.load(directory / f'{prefix}conditioning.pt', map_location='cpu', weights_only=True)
                if settings.get('sigmas'):
                    from comfy_extras.nodes_custom_sampler import SamplerCustom
                    import comfy.samplers
                    sigmas = torch.tensor(settings['sigmas'], dtype=torch.float32)
                    if len(sigmas) != settings['steps'] + 1 or sigmas[-1] != 0:
                        raise ValueError('Turboのサンプリング設定が不正です')
                    result = SamplerCustom.execute(model=model, add_noise=True, noise_seed=settings['seed'], cfg=settings['cfg'],
                        positive=data['positive'], negative=data['negative'], sampler=comfy.samplers.sampler_object(settings['sampler']),
                        sigmas=sigmas, latent_image=data['latent']).result[0]
                else:
                    result = nodes.common_ksampler(model, settings['seed'], settings['steps'], settings['cfg'], settings['sampler'], settings['scheduler'],
                                                  data['positive'], data['negative'], data['latent'])[0]
                torch.save(cpu_tree(result), directory / f'{prefix}latent.pt')
            elif operation == 'decode':
                data = torch.load(directory / f'{prefix}latent.pt', map_location='cpu', weights_only=True)
                pixels = vae().decode(data['samples'])[0]
                save_pixels(pixels, directory / f'{prefix}render.png')
            else:
                raise ValueError('Unknown phase')
    finally:
        stop.set()
        thread.join(timeout=3)


if __name__ == '__main__':
    main()
