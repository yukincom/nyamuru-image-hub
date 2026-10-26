"""Prompt tests and opt-in CPU tests of the ComfyUI nodes, without model weights.

Set QWEN_TEST_COMFY_ROOT and run with the existing Qwen lab Python.
"""
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from qwen_generation import SETTINGS, SKETCH_SETTINGS
from qwen_generation_phase import encode, save_pixels, generation_prompt, configure_sampling_model

comfy_root = os.environ.get('QWEN_TEST_COMFY_ROOT')
if comfy_root:
    sys.path.insert(0, comfy_root)
    prior_args = sys.argv
    sys.argv = [sys.argv[0], '--cpu']
    try:
        import comfy.options
        comfy.options.enable_args_parsing()
        import torch
        import nodes
        import comfy.sample
        import comfy.latent_formats
        from PIL import Image
    finally:
        sys.argv = prior_args
    torch.set_num_threads(1)


class QwenGenerationPromptTest(unittest.TestCase):
    def test_panel_and_page_paint_keep_composition_and_separate_character_labels(self):
        references = [dict(role='paint', character_keys=[]),
                      dict(role='identity', character_keys=['alice']),
                      dict(role='identity', character_keys=['bob'])]
        english = dict(prompt='Alice stands left of Bob.', references=[dict(label=label) for label in
                       ('Composition', 'Alice character sheet', 'Bob character sheet')])
        for owner in ('panel', 'page'):
            with self.subTest(owner=owner):
                config = dict(owner_key=owner, mode='paint', references=references, settings=SETTINGS,
                              character_keys=['alice', 'bob'])
                prompt = generation_prompt(config, english)
                self.assertTrue(prompt.startswith('Edit <image1>. Preserve its pose and composition'))
                self.assertIn('<image2>: Alice character sheet. Assigned characters: Character 1.', prompt)
                self.assertIn('<image3>: Bob character sheet. Assigned characters: Character 2.', prompt)
                self.assertIn('Alice stands left of Bob.', prompt)
                self.assertNotIn('RGBA image with transparency', prompt)
                self.assertNotIn('background is transparent', prompt)
                self.assertNotIn('Extract the single person', prompt)

    def test_shared_character_sheet_does_not_turn_distinct_characters_into_one_person(self):
        config = dict(owner_key='panel', mode='new', settings=SETTINGS, character_keys=['alice', 'bob'],
                      references=[dict(role='identity', character_keys=['bob', 'alice'])])
        english = dict(prompt='Draw Alice and Bob.', references=[dict(label='Alice and Bob character designs')])
        prompt = generation_prompt(config, english)
        self.assertIn('Alice and Bob character designs.', prompt)
        self.assertIn('Assigned characters: Character 2, Character 1.', prompt)
        self.assertIn('Character identities and drawing styles.', prompt)
        self.assertNotIn('one person', prompt)
        self.assertNotIn('transparent', prompt)

    def test_new_groups_without_references_do_not_request_person_extraction(self):
        for owner in ('panel', 'page'):
            with self.subTest(owner=owner):
                config = dict(owner_key=owner, mode='new', references=[], settings=SETTINGS)
                prompt = generation_prompt(config, dict(prompt='An empty room.', references=[]))
                self.assertEqual(prompt, 'Create a new drawing with the requested composition. An empty room.')

    def test_individual_figure_keeps_single_person_reference_and_transparent_format(self):
        config = dict(owner_key='figure-0', mode='new', settings=SETTINGS,
                      references=[dict(role='identity', character_keys=['alice'])])
        prompt = generation_prompt(config, dict(prompt='Draw Alice.', references=[dict(label='Alice character sheet')]))
        self.assertIn('alternate views are one person, not extra people.', prompt)
        self.assertTrue(prompt.startswith('This is an RGBA image with transparency.'))
        self.assertTrue(prompt.endswith('The image has alpha channel and the background is transparent.'))
        self.assertNotIn('Assigned characters', prompt)

    def test_authored_group_text_keeps_newlines_and_repeated_spaces_in_final_prompt(self):
        for owner in ('page', 'panel'):
            with self.subTest(owner=owner):
                literal = 'ゆき  は\n笑う'
                config = dict(owner_key=owner, mode='new', references=[], settings=SETTINGS, literal_text=[literal])
                prompt = generation_prompt(config, dict(prompt=f'Draw the words "{literal}".', references=[]))
                self.assertIn(f'"{literal}"', prompt)


class RecordingClip:
    def __init__(self):
        self.calls = []

    def tokenize(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return prompt

    def encode_from_tokens_scheduled(self, tokens):
        return [[torch.zeros(1, 1, 4096), {}]]


class RecordingVae:
    def __init__(self):
        self.images = []

    def encode(self, image):
        self.images.append(image)
        return torch.ones(1, 64, image.shape[1] // 16, image.shape[2] // 16)


@unittest.skipUnless(comfy_root, 'Set QWEN_TEST_COMFY_ROOT to test the existing ComfyUI runtime on CPU')
class QwenPhaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.config = dict(mode='new', owner_key='figure-0', references=[], output_size=[896, 1184], settings=SETTINGS)
        self.english = dict(prompt='Draw a bust-up portrait.', references=[])
        self.clip, self.vae = RecordingClip(), RecordingVae()

    def reference(self, size, color, label, role='identity'):
        name = f'image-{len(self.config["references"]) + 1}.png'
        Image.new('RGBA', size, color).save(self.directory / name)
        self.config['references'].append(dict(file=name, role=role, character_keys=['person'] if role=='identity' else []))
        self.english['references'].append(dict(file=name, label=label))

    def run_encode(self):
        return encode(self.config, self.english, self.directory, self.clip, self.vae)

    def assert_image_count(self, result, count):
        self.assertEqual(len(self.vae.images), count)
        self.assertEqual(len(self.clip.calls), 2)
        for _, arguments in self.clip.calls:
            self.assertEqual(len(arguments['images']), count)
        for kind in ('positive', 'negative'):
            self.assertEqual(len(result[kind][0][1].get('reference_latents', [])), count)

    def assert_output_dimensions(self, result):
        # Use the same channel/downscale conversion that common_ksampler uses.
        model = SimpleNamespace(get_model_object=lambda _: comfy.latent_formats.QwenImage21())
        latent = result['latent']
        samples = comfy.sample.fix_empty_latent_channels(model, latent['samples'], latent.get('downscale_ratio_spacial'))
        self.assertEqual(list(samples.shape), [1, 64, 74, 56])

    def test_one_reference_stays_one_and_target_size_is_independent(self):
        self.reference((128, 64), (255, 0, 0, 255), 'Red character sheet')
        result = self.run_encode()
        self.assert_image_count(result, 1)
        self.assert_output_dimensions(result)
        prompt = self.clip.calls[0][0]
        self.assertIn('Red character sheet', prompt)
        self.assertIn('Draw a bust-up portrait.', prompt)
        self.assertNotIn('<image', prompt)
        self.assertNotIn('blank canvas', prompt)
        self.assertTrue(prompt.startswith('This is an RGBA image with transparency.'))
        self.assertTrue(prompt.endswith('The image has alpha channel and the background is transparent.'))
        self.assertNotIn('\n', prompt)
        self.assertEqual(self.vae.images[0][0, 0, 0].tolist(), [1, 0, 0, 1])

    def test_two_references_stay_two_with_correct_numbering(self):
        self.reference((128, 64), (255, 0, 0, 255), 'Red character sheet')
        self.reference((64, 128), (0, 0, 255, 255), 'Blue portrait')
        result = self.run_encode()
        self.assert_image_count(result, 2)
        self.assert_output_dimensions(result)
        prompt = self.clip.calls[0][0]
        self.assertIn('<image1>: Red character sheet', prompt)
        self.assertIn('<image2>: Blue portrait', prompt)
        self.assertNotIn('<image3>', prompt)
        self.assertEqual([image[0, 0, 0].tolist() for image in self.vae.images], [[1, 0, 0, 1], [0, 0, 1, 1]])

    def test_no_reference_uses_custom_output_without_fabricating_images(self):
        self.config['owner_key'] = 'background'
        result = self.run_encode()
        self.assert_image_count(result, 0)
        self.assert_output_dimensions(result)
        self.assertNotIn('RGBA image with transparency', self.clip.calls[0][0])

    def test_paint_keeps_explicit_paint_as_first_image_and_its_size(self):
        self.config['mode'] = 'paint'
        self.reference((896, 1184), (0, 255, 0, 255), 'Painted pose', 'paint')
        self.reference((128, 64), (255, 0, 0, 255), 'Red character sheet')
        result = self.run_encode()
        self.assert_image_count(result, 2)
        self.assertEqual(list(result['latent']['samples'].shape), [1, 64, 74, 56])
        self.assertIn('Edit <image1>', self.clip.calls[0][0])
        self.assertIn('<image2>: Red character sheet', self.clip.calls[0][0])

    def test_legacy_canvas_is_not_silently_encoded(self):
        self.config['references'].append(dict(role='canvas'))
        with self.assertRaisesRegex(ValueError, '新しい生成を準備'):
            self.run_encode()
        self.assertEqual(self.clip.calls, [])
        self.assertEqual(self.vae.images, [])

    def test_source_correction_and_identity_are_separate_inputs_with_explicit_roles(self):
        self.config['mode'] = 'paint'
        self.reference((896, 1184), (0, 255, 0, 255), 'Source', 'paint')
        self.reference((896, 1184), (255, 0, 0, 128), 'Mask', 'correction')
        self.reference((128, 64), (0, 0, 255, 255), 'Character sheet')
        self.english['prompt'] = 'Change the marked hand to a fist.'
        result = self.run_encode()
        self.assert_image_count(result, 3)
        self.assertEqual(list(result['latent']['samples'].shape), [1, 64, 74, 56])
        prompt = self.clip.calls[0][0]
        self.assertIn('<image1>: the source image and canvas', prompt)
        self.assertIn('<image2>: drawn annotations or a separate mask', prompt)
        self.assertIn('<image3>: Character sheet', prompt)
        self.assertIn('all untargeted content', prompt)
        self.assertIn('Remove the edit-guide marks', prompt)
        self.assertNotIn('Create a new drawing', prompt)
        self.assertEqual([image[0, 0, 0, :3].tolist() for image in self.vae.images], [[0, 1, 0], [1, 0, 0], [0, 0, 1]])

    def test_annotated_image_alone_is_canvas_and_does_not_invent_image_tags(self):
        self.reference((896, 1184), (255, 0, 0, 255), 'Annotated art', 'correction')
        result = self.run_encode()
        self.assert_image_count(result, 1)
        self.assert_output_dimensions(result)
        prompt = self.clip.calls[0][0]
        self.assertIn('the annotated input image and canvas', prompt)
        self.assertIn('Edit the supplied image only as requested', prompt)
        self.assertNotIn('<image', prompt)

    def test_decoded_rgba_pixels_are_saved_with_size_and_alpha(self):
        pixels = torch.zeros(32, 64, 4)
        pixels[:, :, 0] = 1
        pixels[:, :, 3] = .5
        output = self.directory / 'render.png'
        save_pixels(pixels, output)
        with Image.open(output) as image:
            self.assertEqual(image.mode, 'RGBA')
            self.assertEqual(image.size, (64, 32))
            self.assertEqual(image.getpixel((0, 0)), (255, 0, 0, 128))

    def test_sketch_crop_and_sheet_stay_separate_with_scene_overrides_and_alpha(self):
        self.config.update(mode='sketch', settings=SKETCH_SETTINGS, output_size=[800, 736])
        self.reference((544, 496), (0, 0, 0, 255), 'Single rough pose', role='sketch')
        self.reference((1024, 512), (255, 255, 255, 255), 'Character design sheet')
        self.english['prompt'] = ('Edit <image1> into the character from <image2>, the Character design sheet. '
                                  'Preserve intentional cropping. Scene instructions take priority. '
                                  'Look at her toes, with a stern expression and cold sweat. '
                                  'Keep white clothing and skin opaque.')
        result = self.run_encode()
        self.assert_image_count(result, 2)
        self.assertEqual(list(result['latent']['samples'].shape), [1, 64, 46, 50])
        prompt = self.clip.calls[0][0]
        self.assertIn('Look at her toes', prompt)
        self.assertIn('Character design sheet', prompt)
        self.assertIn('intentional cropping', prompt)
        self.assertIn('take priority', prompt)
        self.assertIn('white clothing and skin', prompt)
        self.assertIn('plain white background', prompt)
        self.assertFalse(prompt.startswith('This is an RGBA image with transparency.'))
        self.assertEqual(prompt, generation_prompt(self.config, self.english))

    def test_alpha_pass_references_only_finished_art_at_exact_size(self):
        self.config.update(mode='sketch', settings=SKETCH_SETTINGS, output_size=[800, 736])
        self.reference((544, 496), (0, 0, 0, 255), 'Rough pose', role='sketch')
        self.reference((128, 64), (255, 0, 0, 255), 'Character sheet')
        Image.new('RGBA', (800, 736), (0, 255, 0, 255)).save(self.directory / 'render.png')
        result = encode(self.config, self.english, self.directory, self.clip, self.vae, alpha_pass=True)
        self.assert_image_count(result, 1)
        self.assertEqual(list(result['latent']['samples'].shape), [1, 64, 46, 50])
        self.assertEqual(self.vae.images[0][0, 0, 0].tolist(), [0, 1, 0, 1])
        self.assertIn('Remove only the plain white background', self.clip.calls[0][0])
        self.assertNotIn('bust-up portrait', self.clip.calls[0][0])


@unittest.skipUnless(comfy_root, 'Set QWEN_TEST_COMFY_ROOT to test the installed attention on CPU')
class QwenAttentionTest(unittest.TestCase):
    def setUp(self):
        from comfy.model_patcher import ModelPatcher
        from comfy.ldm.modules.attention import get_attention_function
        self.before = ModelPatcher(torch.nn.Linear(1, 1), torch.device('cpu'), torch.device('cpu'))
        self.before.set_model_optimized_attention(get_attention_function('sub_quad'))
        self.after = self.before.clone()
        configure_sampling_model(self.after)
        generator = torch.Generator().manual_seed(42)
        self.q, self.k, self.v = [torch.randn(1, 37, 2, 8, generator=generator) for _ in range(3)]
        text_mask = torch.full((5, 5), float('-inf')).triu(1)
        # Causal text, three independent reference segments, then generated pixels.
        self.segments = [(0, 5, text_mask), (5, 13, None), (13, 21, None),
                         (21, 29, None), (29, 37, None)]

    def options(self, model):
        return model.model_options['transformer_options']

    def test_reference_cache_stays_lossless_on_cpu_with_abundant_system_ram(self):
        from comfy.ldm.qwen_image21.model import QwenImage21Transformer2DModel
        state = SimpleNamespace(prefix_cache=None)
        options = self.options(self.after)['qwen_image21_cache']
        with patch('comfy.model_management.get_free_memory', return_value=1024 * 2**30):
            cache, ready = QwenImage21Transformer2DModel.select_prefix_cache(
                state, torch.tensor([1]), 1024, torch.device('mps'), options)
        self.assertFalse(ready)
        self.assertEqual(cache.store_device, torch.device('cpu'))
        values = torch.stack([self.k, self.v], dim=1)
        cache.put(0, values)
        actual = cache.take(0, torch.device('cpu'), values.dtype, 1)
        torch.testing.assert_close(actual, values, rtol=0, atol=0)
        self.assertNotIn('qwen_image21_cache', self.options(self.before))

    def test_three_references_keep_causal_masks_and_full_attention_values(self):
        from comfy.ldm.qwen_image21.model import block_causal_attention
        reference = block_causal_attention(self.segments, self.options(self.before))(self.q, self.k, self.v, 2)
        actual = block_causal_attention(self.segments, self.options(self.after))(self.q, self.k, self.v, 2)
        torch.testing.assert_close(actual, reference, rtol=1e-5, atol=1e-6)
        changed_v = self.v.clone(); changed_v[:, 29:] += 100
        changed = block_causal_attention(self.segments, self.options(self.after))(self.q, self.k, changed_v, 2)
        # Later generated tokens must not influence earlier text/reference blocks.
        torch.testing.assert_close(changed[:, :29], actual[:, :29], rtol=0, atol=0)
        self.assertFalse(torch.equal(changed[:, 29:], actual[:, 29:]))

    def test_cached_prefix_preserves_the_three_references(self):
        from comfy.ldm.qwen_image21.model import block_causal_attention, prefix_cached_attention
        reference = block_causal_attention(self.segments, self.options(self.before))(self.q, self.k, self.v, 2)[:, 29:]
        cached = prefix_cached_attention(self.k[:, :29], self.v[:, :29], self.options(self.after))
        actual = cached(self.q[:, 29:], self.k[:, 29:], self.v[:, 29:], 2)
        torch.testing.assert_close(actual, reference, rtol=1e-5, atol=1e-6)


if __name__ == '__main__':
    unittest.main()
