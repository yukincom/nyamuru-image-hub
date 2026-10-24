import json
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import ANY, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from nyamuru_voice_intent import LABELS, VoiceIntentService, validate_text
import install_voice_intent as installer

class VoiceIntentTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.service=VoiceIntentService()
        self.service.python=Path(sys.executable)
        self.service.model=Path(self.folder.name)

    def result(self, **changes):
        value=dict(text='保存して',label='save',confidence=1.0,probabilities=[1.0]+[0.0]*18,
                   model='nyamuru-voice-v04-seed43',elapsed_ms=12)
        value.update(changes)
        return subprocess.CompletedProcess([],0,json.dumps(value),'')

    def test_original_text_only_and_offline_bounded_worker(self):
        with patch('nyamuru_voice_intent.subprocess.run',return_value=self.result()) as run:
            value=self.service.classify({'text':'保存して'})
        self.assertEqual(value['label'],'save')
        args,kwargs=run.call_args
        self.assertEqual(json.loads(kwargs['input']),{'text':'保存して'})
        self.assertEqual(kwargs['timeout'],60)
        self.assertEqual(kwargs['env']['HF_HUB_OFFLINE'],'1')
        self.assertNotIn('保存して',args[0])

    def test_invalid_scores_or_wrong_text_fail_closed(self):
        for changes in [{'text':'別の入力'},{'label':'undo'},{'probabilities':[float('nan')]+[0]*18},
                        {'probabilities':[.1]*19},{'confidence':.5},{'model':''},
                        {'elapsed_ms':-1},{'elapsed_ms':float('nan')}]:
            with self.subTest(changes=changes),patch('nyamuru_voice_intent.subprocess.run',return_value=self.result(**changes)):
                with self.assertRaises(ValueError):self.service.classify({'text':'保存して'})

    def test_timeout_releases_slot_and_parallel_request_rejected(self):
        with patch('nyamuru_voice_intent.subprocess.run',side_effect=subprocess.TimeoutExpired('worker',60)):
            with self.assertRaisesRegex(ValueError,'時間内'):self.service.classify({'text':'保存して'})
        self.assertTrue(self.service.lock.acquire(False))
        try:
            with self.assertRaisesRegex(ValueError,'分類中'):self.service.classify({'text':'保存して'})
        finally:self.service.lock.release()

    def test_text_contract_and_label_order(self):
        self.assertEqual(validate_text({'text':'  原文！  '}),'  原文！  ')
        for body in [{},{'text':''},{'text':'a'*4001},{'text':'保存して','label':'save'}]:
            with self.assertRaises(ValueError):validate_text(body)
        self.assertEqual(len(LABELS),19)
        self.assertEqual(LABELS[11],'not_command')

    def test_selected_model_default_and_explicit_override(self):
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(VoiceIntentService().model.name, 'nyamuru-voice-v04-seed43')
            self.assertEqual(VoiceIntentService().python, Path(sys.executable))
        with patch.dict('os.environ', {'NYAMURU_VOICE_INTENT_MODEL': self.folder.name}):
            self.assertEqual(VoiceIntentService().model, Path(self.folder.name))
        with patch.dict('os.environ', {'NYAMURU_VOICE_INTENT_PYTHON': self.folder.name}):
            self.assertEqual(VoiceIntentService().python, Path(self.folder.name))

    def checkpoint(self):
        source=Path(self.folder.name)/'source';source.mkdir()
        config={'id2label':{str(i):name for i,name in enumerate(LABELS)},
                'label2id':{name:i for i,name in enumerate(LABELS)}}
        files={'config.json':json.dumps(config).encode(),'model.safetensors':b'unit-test-weight-bytes',
               'tokenizer.json':b'{}','tokenizer_config.json':b'{}'}
        for name,data in files.items():(source/name).write_bytes(data)
        return source,{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}

    def test_install_checked_checkpoint_preserves_previous_model_and_is_idempotent(self):
        source,hashes=self.checkpoint();root=Path(self.folder.name)/'app'
        previous=root/'models/nyamuru-voice-v02/model.safetensors';previous.parent.mkdir(parents=True)
        previous.write_bytes(b'previous model')
        with patch.object(installer,'ROOT',root),patch.object(installer,'SELECTED_FILES',hashes):
            destination=installer.install(source)
            before={p.name:(p.read_bytes(),p.stat().st_mtime_ns) for p in destination.iterdir()}
            self.assertEqual(installer.install(source),destination)
            self.assertEqual(before,{p.name:(p.read_bytes(),p.stat().st_mtime_ns) for p in destination.iterdir()})
            metadata=json.loads((destination/'provenance.json').read_text())
            self.assertEqual(metadata['seed'],43);self.assertEqual(metadata['epoch'],8)
            self.assertEqual(metadata['files'],hashes)
            (destination/'model.safetensors').write_bytes(b'another existing model')
            with self.assertRaisesRegex(ValueError,'既存'):installer.install(source)
            self.assertEqual((destination/'model.safetensors').read_bytes(),b'another existing model')
        self.assertEqual(previous.read_bytes(),b'previous model')

    def test_mismatched_checkpoint_is_rejected_before_creating_destination(self):
        source,hashes=self.checkpoint();root=Path(self.folder.name)/'app'
        (source/'model.safetensors').write_bytes(b'wrong checkpoint')
        with patch.object(installer,'ROOT',root),patch.object(installer,'SELECTED_FILES',hashes):
            with self.assertRaisesRegex(ValueError,'seed43'):installer.install(source)
        self.assertFalse(root.exists())

    def test_reordered_label_contract_cannot_be_installed(self):
        source,hashes=self.checkpoint();root=Path(self.folder.name)/'app'
        config=json.loads((source/'config.json').read_text());config['label2id']['save']=1
        (source/'config.json').write_text(json.dumps(config));hashes['config.json']=hashlib.sha256((source/'config.json').read_bytes()).hexdigest()
        with patch.object(installer,'ROOT',root),patch.object(installer,'SELECTED_FILES',hashes):
            with self.assertRaisesRegex(ValueError,'19ラベル'):installer.install(source)
        self.assertFalse(root.exists())

    def test_bundle_verification_accepts_complete_clone_and_rejects_lfs_pointer(self):
        source,hashes=self.checkpoint();root=Path(self.folder.name)/'app'
        with patch.object(installer,'ROOT',root),patch.object(installer,'SELECTED_FILES',hashes):
            destination=installer.install(source)
            self.assertEqual(installer.verify_bundle(),destination)
            (destination/'model.safetensors').write_text('version https://git-lfs.github.com/spec/v1\noid sha256:fixture\nsize 123\n')
            with self.assertRaisesRegex(ValueError,'導入手順'):
                installer.verify_bundle()

    def test_bundle_verification_rejects_missing_file_and_wrong_provenance(self):
        source,hashes=self.checkpoint();root=Path(self.folder.name)/'app'
        with patch.object(installer,'ROOT',root),patch.object(installer,'SELECTED_FILES',hashes):
            destination=installer.install(source)
            metadata=json.loads((destination/'provenance.json').read_text())
            metadata['model_id']='another-model'
            (destination/'provenance.json').write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError,'出典'):
                installer.verify_bundle()
            (destination/'tokenizer.json').unlink()
            with self.assertRaisesRegex(ValueError,'setup:vision'):
                installer.verify_bundle()

    def test_bundle_does_not_depend_on_a_model_symlink(self):
        source,hashes=self.checkpoint();root=Path(self.folder.name)/'app'
        with patch.object(installer,'ROOT',root),patch.object(installer,'SELECTED_FILES',hashes):
            destination=installer.install(source)
            weight=destination/'model.safetensors';weight.unlink()
            weight.symlink_to(source/'model.safetensors')
            with self.assertRaisesRegex(ValueError,'symlink'):
                installer.verify_bundle()

    def test_git_bundle_rules_only_include_adopted_model(self):
        root=Path(self.folder.name)/'checkout';root.mkdir()
        repository=Path(__file__).resolve().parents[1]
        for name in ['.gitignore','.gitattributes']:
            (root/name).write_bytes((repository/name).read_bytes())
        subprocess.run(['git','init','-q',str(root)],check=True)
        selected='models/nyamuru-voice-v04-seed43/model.safetensors'
        for name in ['models/nyamuru-voice-v04-seed43/config.json']:
            target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.touch()
            result=subprocess.run(['git','check-ignore','--no-index',name],cwd=root,capture_output=True)
            self.assertEqual(result.returncode,1,name)
        for name in [selected,'models/nyamuru-voice-v02/model.safetensors','models/other/config.json','random.safetensors']:
            target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.touch()
            result=subprocess.run(['git','check-ignore','--no-index',name],cwd=root,capture_output=True)
            self.assertEqual(result.returncode,0,name)
        result=subprocess.run(['git','check-attr','filter','--',selected],cwd=root,capture_output=True,text=True,check=True)
        self.assertEqual(result.stdout.strip(),f'{selected}: filter: unspecified')

    def downloadable_fixture(self):
        source, hashes = self.checkpoint()
        root = Path(self.folder.name)/'app'
        with patch.object(installer, 'ROOT', root), patch.object(installer, 'SELECTED_FILES', hashes):
            destination = installer.install(source)
        weight = (destination/'model.safetensors').read_bytes()
        (destination/'model.safetensors').unlink()
        return root, destination, hashes, weight

    def test_download_is_verified_and_second_call_uses_local_model(self):
        root, destination, hashes, weight = self.downloadable_fixture()
        with patch.object(installer, 'ROOT', root), patch.object(installer, 'SELECTED_FILES', hashes), patch.object(installer, 'WEIGHT_BYTES', len(weight)), patch.object(installer.urllib.request, 'urlopen', return_value=io.BytesIO(weight)) as fetch:
            self.assertEqual(installer.download_bundle(), destination)
            self.assertEqual(installer.download_bundle(), destination)
            fetch.assert_called_once_with(installer.WEIGHT_URL, timeout=120, context=ANY)
            context = fetch.call_args.kwargs['context']
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, installer.ssl.CERT_REQUIRED)
        self.assertEqual((destination/'model.safetensors').read_bytes(), weight)
        self.assertEqual(list(destination.glob('.download-*')), [])

    def test_download_uses_setup_certificates_and_keeps_verified_system_fallback(self):
        certificates = Mock()
        certificates.where.return_value = '/fixture/maintained-ca-bundle.pem'
        with patch.dict(sys.modules, {'certifi': certificates}), patch.object(installer.ssl, 'create_default_context') as create:
            self.assertIs(installer.download_ssl_context(), create.return_value)
            create.assert_called_once_with(cafile='/fixture/maintained-ca-bundle.pem')
        with patch.dict(sys.modules, {'certifi': None}):
            context = installer.download_ssl_context()
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, installer.ssl.CERT_REQUIRED)

    def test_failed_download_never_leaves_a_partial_model(self):
        root, destination, hashes, weight = self.downloadable_fixture()
        for data in [weight[:-1], b'x'*len(weight), weight+b'x']:
            with self.subTest(data=data), patch.object(installer, 'ROOT', root), patch.object(installer, 'SELECTED_FILES', hashes), patch.object(installer, 'WEIGHT_BYTES', len(weight)), patch.object(installer.urllib.request, 'urlopen', return_value=io.BytesIO(data)):
                with self.assertRaisesRegex(ValueError, 'サイズ|SHA-256'):
                    installer.download_bundle()
            self.assertFalse((destination/'model.safetensors').exists())
            self.assertEqual(list(destination.glob('.download-*')), [])

    def test_download_preserves_existing_mismatched_weight_and_rejects_symlink(self):
        root, destination, hashes, weight = self.downloadable_fixture()
        target = destination/'model.safetensors'; target.write_bytes(b'other model')
        with patch.object(installer, 'ROOT', root), patch.object(installer, 'SELECTED_FILES', hashes), patch.object(installer.urllib.request, 'urlopen') as fetch:
            with self.assertRaisesRegex(ValueError, 'seed43'):
                installer.download_bundle()
            self.assertEqual(target.read_bytes(), b'other model')
            target.unlink(); target.symlink_to(destination/'config.json')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                installer.download_bundle()
            fetch.assert_not_called()

    def test_repository_bundle_matches_approved_model(self):
        self.assertEqual(installer.verify_bundle().name,'nyamuru-voice-v04-seed43')

if __name__=='__main__':unittest.main()
