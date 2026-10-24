import test from 'node:test';
import assert from 'node:assert/strict';
import { blobRevision, writeProjectFile } from '../src/lib/browserFiles.ts';

function handleFixture(content = 'before', fail = false) {
  let file = new File([content], 'test.nyamuru'), opened = 0, aborted = false, closed = false;
  return { get state() { return { file, opened, aborted, closed }; }, replace(value) { file = new File([value], 'test.nyamuru'); },
    handle: { name: file.name, getFile: async () => file, async createWritable() { opened++; let draft;
      return { async write(blob) { if (fail) throw Error('disk full'); draft = blob; }, async close() { file = new File([draft], 'test.nyamuru'); closed = true; }, async abort() { aborted = true; } };
    } },
  };
}
test('writes and closes the selected file, and returns a revision for the next save', async () => {
  const fixture = handleFixture(), revision = await blobRevision(fixture.state.file);
  const result = await writeProjectFile(new Blob(['after']), { handle: fixture.handle, revision });
  assert.equal(await fixture.state.file.text(), 'after');
  assert.equal(result.binding.revision, await blobRevision(fixture.state.file));
  assert.equal(fixture.state.closed, true);
});
test('external modification is rejected before opening a writer and never loses either version', async () => {
  const fixture = handleFixture(), revision = await blobRevision(fixture.state.file);
  fixture.replace('other tab saved');
  await assert.rejects(writeProjectFile(new Blob(['my work']), { handle: fixture.handle, revision }), /他の画面/);
  assert.equal(fixture.state.opened, 0); assert.equal(await fixture.state.file.text(), 'other tab saved');
});
test('failed writes abort the temporary writer without reporting success', async () => {
  const fixture = handleFixture('before', true);
  await assert.rejects(writeProjectFile(new Blob(['after']), { handle: fixture.handle, revision: await blobRevision(fixture.state.file) }), /disk full/);
  assert.equal(await fixture.state.file.text(), 'before'); assert.equal(fixture.state.aborted, true); assert.equal(fixture.state.closed, false);
});
test('an unbound write is rejected instead of downloading a standalone project', async () => {
  await assert.rejects(writeProjectFile(new Blob(['work']), null), /作品フォルダー/);
});

test('simultaneous saves with the same revision allow one winner and preserve the conflict', async () => {
  const fixture = handleFixture(), revision = await blobRevision(fixture.state.file);
  const outcomes = await Promise.allSettled(['edit-A', 'edit-B'].map(text => writeProjectFile(new Blob([text]), { handle: fixture.handle, revision })));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(item => item.status === 'rejected').reason.message, /他の画面/);
  assert.equal(await fixture.state.file.text(), 'edit-A');
});

test('a change while acquiring the native writer is rejected before writing', async () => {
  const fixture = handleFixture(), revision = await blobRevision(fixture.state.file);
  const open = fixture.handle.createWritable;
  fixture.handle.createWritable = async options => {
    assert.deepEqual(options, { mode: 'exclusive' });
    fixture.replace('changed before lock');
    return open();
  };
  await assert.rejects(writeProjectFile(new Blob(['edit']), { handle: fixture.handle, revision }), /他の画面/);
  assert.equal(await fixture.state.file.text(), 'changed before lock');
  assert.equal(fixture.state.aborted, true);
});
