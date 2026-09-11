'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('./storage.cjs');

function syntheticProject() {
  return {
    schemaVersion: 1,
    id: 'DEMO-PROJECT-001',
    name: 'Синтетический проект',
    harnesses: [
      { id: 'HARNESS-001', name: 'Демонстрационный жгут', wireCount: 20 },
    ],
  };
}

async function fixture(testContext, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'techmap-storage-'));
  testContext.after(() => fs.rm(root, { recursive: true, force: true }));
  const programDataDir = path.join(root, 'program-data');
  const userDataDir = path.join(root, 'user-data');
  const storage = createStorage({ programDataDir, userDataDir, ...options });
  await storage.initialize({ product: 'TECHMAP-GRAPHER storage experiment', version: '0.0.0-m0' });
  return { root, programDataDir, userDataDir, storage };
}

test('program-data and user-data stay physically separate', async (t) => {
  const { programDataDir, userDataDir, storage } = await fixture(t);
  await storage.saveProject(syntheticProject());

  assert.deepEqual((await fs.readdir(programDataDir)).sort(), ['app-info.json']);
  assert.deepEqual((await fs.readdir(userDataDir)).sort(), ['backups', 'projects', 'temp']);
  const saved = await fs.readdir(path.join(userDataDir, 'projects', 'DEMO-PROJECT-001'));
  assert.deepEqual(saved, ['revision-00000001.json']);
});

test('atomic save never exposes a partially written revision', async (t) => {
  let failNextPublish = false;
  const { userDataDir, storage } = await fixture(t, {
    testHooks: {
      beforeProjectPublish() {
        if (failNextPublish) throw new Error('simulated power loss before publish');
      },
    },
  });
  const original = syntheticProject();
  await storage.saveProject(original);

  failNextPublish = true;
  const changed = structuredClone(original);
  changed.name = 'Это изменение не должно появиться';
  await assert.rejects(storage.saveProject(changed), /simulated power loss/);

  assert.deepEqual(await storage.loadProject(original.id), original);
  const files = await fs.readdir(path.join(userDataDir, 'projects', original.id));
  assert.deepEqual(files, ['revision-00000001.json']);
  assert.equal(files.some((file) => file.includes('.tmp-')), false);
});

test('migration backs up first, transforms a copy, then publishes', async (t) => {
  const { storage } = await fixture(t);
  const original = syntheticProject();
  await storage.saveProject(original);

  const result = await storage.migrateProject(original.id, 2, {
    1(candidate) {
      candidate.schemaVersion = 2;
      candidate.projectStatus = 'draft';
      return candidate;
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.project.schemaVersion, 2);
  assert.equal(result.project.projectStatus, 'draft');
  const backup = await storage.readVerifiedBackup(result.backup.backupId);
  assert.deepEqual(backup.project, original);
  assert.equal((await storage.loadProject(original.id)).schemaVersion, 2);
});

test('migration is conditional and does not back up an up-to-date project', async (t) => {
  const { storage } = await fixture(t);
  const original = syntheticProject();
  await storage.saveProject(original);

  const result = await storage.migrateProject(original.id, 1, {});

  assert.equal(result.changed, false);
  assert.equal(result.backup, null);
  assert.deepEqual(result.project, original);
  assert.deepEqual(await fs.readdir(storage.layout.backupsDir), []);
});

test('failed migration retains original and a verified pre-migration backup', async (t) => {
  const { storage } = await fixture(t);
  const original = syntheticProject();
  await storage.saveProject(original);

  await assert.rejects(
    storage.migrateProject(original.id, 2, {
      1(candidate) {
        candidate.name = 'Изменённая рабочая копия';
        throw new Error('synthetic migration failure');
      },
    }),
    /synthetic migration failure/,
  );

  assert.deepEqual(await storage.loadProject(original.id), original);
  const backups = await fs.readdir(storage.layout.backupsDir);
  assert.equal(backups.length, 1);
  assert.deepEqual((await storage.readVerifiedBackup(backups[0])).project, original);
});

test('restore creates a new project and does not modify the source project', async (t) => {
  const { storage } = await fixture(t);
  const original = syntheticProject();
  await storage.saveProject(original);
  const backup = await storage.createBackup(original.id, 'restore-test');

  const restored = await storage.restoreBackup(
    backup.backupId,
    'DEMO-PROJECT-RESTORED',
    'Восстановленная копия',
  );

  assert.equal(restored.id, 'DEMO-PROJECT-RESTORED');
  assert.equal(restored.restoredFrom.sourceProjectId, original.id);
  assert.deepEqual(restored.harnesses, original.harnesses);
  assert.deepEqual(await storage.loadProject(original.id), original);
  assert.deepEqual(await storage.loadProject(restored.id), restored);
  await assert.rejects(
    storage.restoreBackup(backup.backupId, original.id),
    /restore destination already exists/,
  );
});

test('tampered backup is rejected before restore', async (t) => {
  const { storage } = await fixture(t);
  const original = syntheticProject();
  await storage.saveProject(original);
  const backup = await storage.createBackup(original.id, 'integrity-test');
  const projectFile = path.join(storage.layout.backupsDir, backup.backupId, 'project.json');
  await fs.writeFile(projectFile, '{"tampered":true}\n', 'utf8');

  await assert.rejects(
    storage.restoreBackup(backup.backupId, 'DEMO-PROJECT-TAMPERED'),
    /backup integrity check failed/,
  );
  await assert.rejects(storage.loadProject('DEMO-PROJECT-TAMPERED'), /project not found/);
});
