'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('./storage.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'techmap-storage-demo-'));
  const storage = createStorage({
    programDataDir: path.join(root, 'program-data'),
    userDataDir: path.join(root, 'user-data'),
  });
  await storage.initialize({ product: 'TECHMAP-GRAPHER storage experiment', version: '0.0.0-m0' });

  const project = {
    schemaVersion: 1,
    id: 'DEMO-PROJECT-001',
    name: 'Синтетический проект',
    harnesses: [{ id: 'HARNESS-001', name: 'Демонстрационный жгут', wireCount: 20 }],
  };
  await storage.saveProject(project);
  const migration = await storage.migrateProject(project.id, 2, {
    1(candidate) {
      candidate.schemaVersion = 2;
      candidate.projectStatus = 'draft';
      return candidate;
    },
  });
  const restored = await storage.restoreBackup(
    migration.backup.backupId,
    'DEMO-PROJECT-RESTORED',
  );

  console.log(JSON.stringify({
    temporaryRoot: root,
    layout: storage.layout,
    migratedProject: await storage.loadProject(project.id),
    restoredProject: restored,
    originalBackup: await storage.readVerifiedBackup(migration.backup.backupId),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
