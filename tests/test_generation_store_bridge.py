from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import generation_store as store_module

class PngValidationTests(unittest.TestCase):
    # 見込み: PillowのPNG検査とdecodeに集約しても破損/過大寸法は受付で検出できる。
    # 合格: 正常PNGは寸法を返し、CRC破損・切断・過大寸法を拒否。範囲: 実fixture、モデルなし。
    def test_png_input_is_decoded_once_with_bounded_dimensions(self):
        fixtures = Path(__file__).parent / 'fixtures/generation_qa'
        dimensions = store_module.validate_png((fixtures / 'valid-four-color.png').read_bytes())
        self.assertGreater(min(dimensions), 0)
        for name in ('invalid-crc.png', 'invalid-truncated.png', 'invalid-unsafe-dimension.png'):
            with self.subTest(name=name), self.assertRaises((ValueError, OSError, SyntaxError)):
                store_module.validate_png((fixtures / name).read_bytes())


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'jobs'
        self.store = store_module.JobStore(self.root)
        self.job_id = str(uuid4())
        self.store.create(self.job_id)

    def test_atomic_write_interruption_never_publishes_partial_files(self):
        for name in ('request.json', 'request.sha256', 'event-00000000000000000001-' + str(uuid4()) + '.json', 'output.png'):
            with self.subTest(name=name):
                real_write = store_module.os.write
                count = 0
                def partial(fd, raw):
                    nonlocal count
                    count += 1
                    if count == 1:
                        return real_write(fd, raw[:1])
                    raise OSError('disk full')
                with patch.object(store_module.os, 'write', partial), self.assertRaises(OSError):
                    self.store.write_once(self.job_id, name, b'complete data')
                self.assertFalse((self.root / self.job_id / name).exists())
                self.store.write_once(self.job_id, name, b'complete data')
                self.assertEqual(self.store.read(self.job_id, name), b'complete data')

    # 見込み/合格: 既存内容を読み返さずOSの排他作成で上書きを拒否し、外部リンクを辿らない。範囲: 実ファイル操作。
    def test_immutable_write_and_symlink_rejection(self):
        self.store.write_once(self.job_id, 'request.json', b'first')
        for raw in (b'first', b'second'):
            with self.assertRaises(FileExistsError):
                self.store.write_once(self.job_id, 'request.json', raw)
        self.assertEqual(self.store.read(self.job_id, 'request.json'), b'first')
        (self.root / self.job_id / 'link').symlink_to(self.root / self.job_id / 'request.json')
        with self.assertRaises(OSError):
            self.store.read(self.job_id, 'link')



class GenerationCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'cache'
        self.store = store_module.GenerationCacheStore(self.root)

    def write_entry(self, *, profile_id='a' * 64, profile_label='Saved generation profile',
                    kind='series', owner_id='series-1', owner_label='連載作品', source_sha=None,
                    last_used=None):
        source_sha = source_sha or hashlib.sha256(f'{profile_id}:{kind}:{owner_id}'.encode()).hexdigest()
        identity = {
            'schema_version': store_module.CACHE_SCHEMA_VERSION, 'profile_id': profile_id,
            'owner_kind': kind, 'owner_id': owner_id, 'source_sha256': source_sha,
            'target_width': 1024, 'target_height': 1024, 'fit_mode': 'fit',
            'fit_algorithm_version': 'fixture-fit-v1',
            'vae_sha256': 'b' * 64,
        }
        entry_id = store_module.sha256(store_module.canonical(identity))
        raw = f'latent:{entry_id}'.encode()
        stamp = (last_used or datetime.now(timezone.utc)).isoformat()
        metadata = {
            **identity, 'profile_label': profile_label, 'owner_label': owner_label,
            'entry_id': entry_id, 'source_width': 512, 'source_height': 512,
            'reference_label': '人物資料', 'created_at': stamp, 'last_used_at': stamp,
            'latent_sha256': store_module.sha256(raw), 'latent_byte_size': len(raw),
            'latent_shape': [1, 16, 128, 128], 'latent_dtype': 'torch.bfloat16',
        }
        owner_hash = self.store.owner_hash(kind, owner_id)
        directory = self.root / profile_id / kind / owner_hash / entry_id
        directory.mkdir(parents=True)
        (directory / 'reference.safetensors').write_bytes(raw)
        (directory / 'metadata.json').write_bytes(store_module.canonical(metadata))
        return entry_id, directory

    def test_summary_separates_profiles_and_reports_series_and_one_shot_retention(self):
        now = datetime(2026, 9, 10, tzinfo=timezone.utc)
        self.write_entry(last_used=now - timedelta(days=90))
        other_profile = 'b' * 64
        self.write_entry(profile_id=other_profile, profile_label='別モデル', kind='one-shot',
                         owner_id='episode-2', owner_label='読み切り', last_used=now - timedelta(days=5))
        summary = self.store.summary(now=now)
        self.assertEqual(len(summary['profiles']), 2)
        owners = [owner for profile in summary['profiles'] for owner in profile['owners']]
        series = next(owner for owner in owners if owner['kind'] == 'series')
        one_shot = next(owner for owner in owners if owner['kind'] == 'one-shot')
        self.assertIsNone(series['expires_at'])
        self.assertFalse(series['expired'])
        self.assertEqual(datetime.fromisoformat(one_shot['expires_at']), now + timedelta(days=25))
        self.assertFalse(one_shot['expired'])
        self.assertGreater(sum(profile['byte_size'] for profile in summary['profiles']), 0)

    def test_cleanup_removes_only_expired_one_shot_entries(self):
        now = datetime(2026, 9, 10, tzinfo=timezone.utc)
        _series_id, series_path = self.write_entry(last_used=now - timedelta(days=400))
        _old_id, old_path = self.write_entry(kind='one-shot', owner_id='old-episode', owner_label='古い読み切り',
                                             last_used=now - timedelta(days=31))
        _fresh_id, fresh_path = self.write_entry(kind='one-shot', owner_id='fresh-episode', owner_label='新しい読み切り',
                                                 last_used=now - timedelta(days=29), source_sha='c' * 64)
        self.assertEqual(self.store.cleanup_expired(now=now), 1)
        self.assertTrue(series_path.exists())
        self.assertFalse(old_path.exists())
        self.assertTrue(fresh_path.exists())

    def test_delete_owner_across_profiles_then_delete_one_profile(self):
        profile_b = 'b' * 64
        self.write_entry(owner_id='series-1')
        self.write_entry(profile_id=profile_b, profile_label='別モデル', owner_id='series-1', source_sha='b' * 64)
        self.write_entry(profile_id=profile_b, profile_label='別モデル', owner_id='series-2', source_sha='c' * 64)
        deleted = self.store.delete({'scope': 'owner', 'owner_kind': 'series', 'owner_id': 'series-1'})
        self.assertTrue(deleted['deleted'])
        owners = [owner['id'] for profile in deleted['summary']['profiles'] for owner in profile['owners']]
        self.assertEqual(owners, ['series-2'])
        deleted_profile = self.store.delete({'scope': 'profile', 'profile_id': profile_b})
        self.assertTrue(deleted_profile['deleted'])
        self.assertEqual(deleted_profile['summary']['profiles'], [])

    def test_missing_root_is_empty_and_invalid_entries_are_counted_not_deleted(self):
        self.assertEqual(self.store.summary()['profiles'], [])
        entry_id, directory = self.write_entry()
        (directory / 'reference.safetensors').write_bytes(b'corrupt')
        summary = self.store.summary()
        self.assertEqual(summary['profiles'], [])
        self.assertEqual(summary['invalid_entry_count'], 1)
        self.assertTrue((directory / 'reference.safetensors').exists())

    def test_profile_delete_never_follows_a_symlink_outside_the_cache_root(self):
        outside = Path(self.temp.name) / 'outside'
        outside.mkdir()
        marker = outside / 'keep.txt'
        marker.write_text('keep', encoding='utf-8')
        self.root.mkdir()
        profile_id = 'd' * 64
        (self.root / profile_id).symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            self.store.delete({'scope': 'profile', 'profile_id': profile_id})
        self.assertEqual(marker.read_text(encoding='utf-8'), 'keep')



if __name__ == '__main__': unittest.main()
