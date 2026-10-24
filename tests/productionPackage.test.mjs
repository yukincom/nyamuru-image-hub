import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildProductionPackageSelection,
  isSafeProductionPackageRelativePath,
  normalizeProductionPackagePlan,
} from '../src/lib/productionPackage.ts';

const sha256 = 'a'.repeat(64);
const sha512 = 'b'.repeat(128);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function wirePlan() {
  return {
    schema_version: 1,
    kind: 'nyamuru-production-package-plan',
    bagit_available: false,
    algorithms: ['sha256', 'sha512'],
    managed_directories: ['name_data', 'draft_data', 'manuscript_data'],
    missing_directories: [],
    candidates: [
      {
        relative_path: 'draft_data/page-001.psd',
        role: 'editable_psd',
        media_type: 'image/vnd.adobe.photoshop',
        byte_size: 27,
        sha256,
        sha512,
      },
      {
        relative_path: 'name_data/episode.omny.yaml',
        role: 'story_omny',
        media_type: 'application/yaml',
        byte_size: 51,
        sha256: 'c'.repeat(64),
        sha512: 'd'.repeat(128),
      },
    ],
    plan_revision: 'e'.repeat(64),
  };
}

test('Python planをstrictなcamelCase型へ正規化する', () => {
  const plan = normalizeProductionPackagePlan(wirePlan());
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.kind, 'nyamuru-production-package-plan');
  assert.equal(plan.bagitAvailable, false);
  assert.deepEqual(plan.algorithms, ['sha256', 'sha512']);
  assert.deepEqual(plan.managedDirectories, ['name_data', 'draft_data', 'manuscript_data']);
  assert.equal(plan.candidates[0].relativePath, 'draft_data/page-001.psd');
  assert.equal(plan.candidates[0].role, 'editable_psd');
  assert.equal(plan.candidates[0].byteSize, 27);
  assert.equal(plan.planRevision, 'e'.repeat(64));
});

test('管理対象以外・traversal・absolute・backslash pathを拒否する', () => {
  assert.equal(isSafeProductionPackageRelativePath('draft_data/page 1.psd'), true);
  for (const value of [
    '../draft_data/page.psd',
    '/draft_data/page.psd',
    'draft_data/../secret',
    'draft_data\\page.psd',
    'export_data/package',
    'draft_data//page.psd',
    'draft_data/./page.psd',
    'draft_data',
    '',
  ]) {
    assert.equal(isSafeProductionPackageRelativePath(value), false, value);
  }
  assert.equal(isSafeProductionPackageRelativePath('draft_data/\uD800.psd'), false);
});

test('Pythonと同じUnicode scalar順で補助平面pathを受理する', () => {
  const plan = wirePlan();
  plan.candidates = [
    {
      ...plan.candidates[0],
      relative_path: 'draft_data/\uE000.psd',
    },
    {
      ...plan.candidates[1],
      relative_path: 'draft_data/\u{10000}.psd',
    },
  ];
  assert.deepEqual(
    normalizeProductionPackagePlan(plan).candidates.map((candidate) => candidate.relativePath),
    ['draft_data/\uE000.psd', 'draft_data/\u{10000}.psd'],
  );
  plan.candidates.reverse();
  assert.throws(() => normalizeProductionPackagePlan(plan), /relative_path順/);
});

test('未知field・invalid hash・重複path・非決定順を受理しない', () => {
  const extra = wirePlan();
  extra.debug = true;
  assert.throws(() => normalizeProductionPackagePlan(extra), /root fields/);

  const invalidHash = wirePlan();
  invalidHash.candidates[0].sha256 = 'A'.repeat(64);
  assert.throws(() => normalizeProductionPackagePlan(invalidHash), /sha256/);

  const duplicate = wirePlan();
  duplicate.candidates[1].relative_path = duplicate.candidates[0].relative_path;
  assert.throws(() => normalizeProductionPackagePlan(duplicate), /重複/);

  const unsorted = wirePlan();
  unsorted.candidates.reverse();
  assert.throws(() => normalizeProductionPackagePlan(unsorted), /relative_path順/);

  const traversal = wirePlan();
  traversal.candidates[0].relative_path = 'draft_data/../../outside.psd';
  assert.throws(() => normalizeProductionPackagePlan(traversal), /安全な相対path/);
});

test('選択helperはhashを固定し、入力順ではなくplan順で返す', () => {
  const plan = normalizeProductionPackagePlan(wirePlan());
  const selection = buildProductionPackageSelection(plan, [
    'name_data/episode.omny.yaml',
    'draft_data/page-001.psd',
  ]);
  assert.deepEqual(selection, [
    {
      relative_path: 'draft_data/page-001.psd',
      sha256,
      sha512,
    },
    {
      relative_path: 'name_data/episode.omny.yaml',
      sha256: 'c'.repeat(64),
      sha512: 'd'.repeat(128),
    },
  ]);
});

test('選択helperは重複・plan外・unsafe pathを拒否する', () => {
  const plan = normalizeProductionPackagePlan(wirePlan());
  assert.throws(
    () => buildProductionPackageSelection(plan, ['draft_data/page-001.psd', 'draft_data/page-001.psd']),
    /重複/,
  );
  assert.throws(
    () => buildProductionPackageSelection(plan, ['draft_data/not-in-plan.psd']),
    /planにない/,
  );
  assert.throws(
    () => buildProductionPackageSelection(plan, ['../outside.psd']),
    /不正/,
  );
});

test('標準npm testからPython production package core境界も検証する', () => {
  const result = spawnSync('python3', [
    '-m',
    'unittest',
    'discover',
    '-s',
    'tests',
    '-p',
    'test_production_package_core.py',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /OK/);
});
