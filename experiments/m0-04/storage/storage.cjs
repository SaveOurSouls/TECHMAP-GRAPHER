'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const REVISION_PATTERN = /^revision-(\d{8})\.json$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function clone(value) {
  return structuredClone(value);
}

function assertSafeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe non-empty identifier`);
  }
}

function assertProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('project must be an object');
  }
  assertSafeId(project.id, 'project.id');
  if (!Number.isInteger(project.schemaVersion) || project.schemaVersion < 1) {
    throw new Error('project.schemaVersion must be a positive integer');
  }
  if (typeof project.name !== 'string' || project.name.trim() === '') {
    throw new Error('project.name must be a non-empty string');
  }
  if (!Array.isArray(project.harnesses)) {
    throw new Error('project.harnesses must be an array');
  }
}

function resolveLayout(programDataDir, userDataDir) {
  const program = path.resolve(programDataDir);
  const user = path.resolve(userDataDir);
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const relativeProgramToUser = path.relative(program, user);
  const relativeUserToProgram = path.relative(user, program);
  const nested = (relative) => relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (nested(normalize(relativeProgramToUser)) || nested(normalize(relativeUserToProgram))) {
    throw new Error('program-data and user-data must be separate non-nested directories');
  }
  return {
    programDataDir: program,
    userDataDir: user,
    projectsDir: path.join(user, 'projects'),
    backupsDir: path.join(user, 'backups'),
    tempDir: path.join(user, 'temp'),
  };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Windows can reject opening a directory. The file itself is already synced.
    const unsupported = ['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes(error.code);
    if (process.platform !== 'win32' || !unsupported) throw error;
  } finally {
    await handle?.close();
  }
}

async function publishNewFile(target, bytes, beforePublish) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (beforePublish) await beforePublish({ temporary, target });

    // A hard link publishes a fully synced immutable file and cannot overwrite an
    // existing revision. This avoids Windows' non-portable rename-overwrite rules.
    await fs.link(temporary, target);
    await syncDirectory(path.dirname(target));
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

async function revisionFiles(projectDir) {
  let entries;
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && REVISION_PATTERN.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      number: Number(REVISION_PATTERN.exec(entry.name)[1]),
    }))
    .sort((left, right) => left.number - right.number);
}

function createStorage(options) {
  const { programDataDir, userDataDir, testHooks = {} } = options;
  const layout = resolveLayout(programDataDir, userDataDir);

  async function initialize(programInfo) {
    await Promise.all([
      fs.mkdir(layout.programDataDir, { recursive: true }),
      fs.mkdir(layout.projectsDir, { recursive: true }),
      fs.mkdir(layout.backupsDir, { recursive: true }),
      fs.mkdir(layout.tempDir, { recursive: true }),
    ]);
    const infoFile = path.join(layout.programDataDir, 'app-info.json');
    if (!(await pathExists(infoFile))) {
      await publishNewFile(infoFile, jsonBytes(programInfo));
    }
    return clone(layout);
  }

  async function saveProject(project) {
    assertProject(project);
    const projectDir = path.join(layout.projectsDir, project.id);
    await fs.mkdir(projectDir, { recursive: true });

    for (;;) {
      const files = await revisionFiles(projectDir);
      const number = (files.at(-1)?.number ?? 0) + 1;
      const filename = `revision-${String(number).padStart(8, '0')}.json`;
      const target = path.join(projectDir, filename);
      const stored = {
        storageRevision: number,
        savedAt: new Date().toISOString(),
        project: clone(project),
      };
      try {
        await publishNewFile(target, jsonBytes(stored), testHooks.beforeProjectPublish);
        return { projectId: project.id, storageRevision: number, file: target };
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
    }
  }

  async function loadProject(projectId) {
    assertSafeId(projectId, 'projectId');
    const projectDir = path.join(layout.projectsDir, projectId);
    const files = await revisionFiles(projectDir);
    if (files.length === 0) throw new Error(`project not found: ${projectId}`);
    const stored = await readJson(path.join(projectDir, files.at(-1).name));
    assertProject(stored.project);
    if (stored.project.id !== projectId) throw new Error('project directory identity mismatch');
    return clone(stored.project);
  }

  async function createBackup(projectId, reason = 'manual') {
    const project = await loadProject(projectId);
    const backupId = `${projectId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const staging = path.join(layout.tempDir, `backup-${backupId}`);
    const destination = path.join(layout.backupsDir, backupId);
    await fs.mkdir(staging, { recursive: false });
    try {
      const projectData = jsonBytes(project);
      const manifest = {
        backupFormat: 1,
        backupId,
        sourceProjectId: project.id,
        sourceSchemaVersion: project.schemaVersion,
        createdAt: new Date().toISOString(),
        reason,
        projectSha256: crypto.createHash('sha256').update(projectData).digest('hex'),
      };
      await publishNewFile(path.join(staging, 'project.json'), projectData);
      await publishNewFile(path.join(staging, 'manifest.json'), jsonBytes(manifest));
      await fs.rename(staging, destination);
      await syncDirectory(layout.backupsDir);
      return clone(manifest);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async function readVerifiedBackup(backupId) {
    assertSafeId(backupId, 'backupId');
    const directory = path.join(layout.backupsDir, backupId);
    const [manifest, projectData] = await Promise.all([
      readJson(path.join(directory, 'manifest.json')),
      fs.readFile(path.join(directory, 'project.json')),
    ]);
    if (manifest.backupFormat !== 1 || manifest.backupId !== backupId) {
      throw new Error('backup manifest mismatch');
    }
    const digest = crypto.createHash('sha256').update(projectData).digest('hex');
    if (digest !== manifest.projectSha256) throw new Error('backup integrity check failed');
    const project = JSON.parse(projectData.toString('utf8'));
    assertProject(project);
    if (project.id !== manifest.sourceProjectId) throw new Error('backup identity mismatch');
    return { manifest, project };
  }

  async function migrateProject(projectId, targetVersion, migrations) {
    const original = await loadProject(projectId);
    if (!Number.isInteger(targetVersion) || targetVersion < original.schemaVersion) {
      throw new Error('target schema version must not be lower than current version');
    }
    if (targetVersion === original.schemaVersion) {
      return { changed: false, project: original, backup: null };
    }

    const backup = await createBackup(projectId, `before-schema-${targetVersion}`);
    let candidate = clone(original);
    while (candidate.schemaVersion < targetVersion) {
      const fromVersion = candidate.schemaVersion;
      const migration = migrations[fromVersion];
      if (typeof migration !== 'function') {
        throw new Error(`missing migration from schema ${fromVersion}`);
      }
      const input = clone(candidate);
      candidate = await migration(input);
      assertProject(candidate);
      if (candidate.id !== original.id) throw new Error('migration cannot change project identity');
      if (candidate.schemaVersion !== fromVersion + 1) {
        throw new Error(`migration from schema ${fromVersion} must advance exactly one version`);
      }
    }

    // Only the verified candidate is published. A failed migration leaves the
    // latest project revision byte-for-byte unchanged and retains its backup.
    await saveProject(candidate);
    return { changed: true, project: clone(candidate), backup };
  }

  async function restoreBackup(backupId, newProjectId, newName) {
    assertSafeId(newProjectId, 'newProjectId');
    const destination = path.join(layout.projectsDir, newProjectId);
    if ((await revisionFiles(destination)).length > 0) {
      throw new Error(`restore destination already exists: ${newProjectId}`);
    }
    const { manifest, project } = await readVerifiedBackup(backupId);
    const restored = clone(project);
    restored.id = newProjectId;
    restored.name = newName || `${project.name} (восстановлен)`;
    restored.restoredFrom = {
      backupId,
      sourceProjectId: manifest.sourceProjectId,
      restoredAt: new Date().toISOString(),
    };
    await saveProject(restored);
    return restored;
  }

  return {
    layout: clone(layout),
    initialize,
    saveProject,
    loadProject,
    createBackup,
    readVerifiedBackup,
    migrateProject,
    restoreBackup,
  };
}

module.exports = { createStorage };
