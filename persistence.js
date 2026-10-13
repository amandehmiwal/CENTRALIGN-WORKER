const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, 'data');
const runsFile = path.join(dataDirectory, 'runs.json');
const checkpointsDirectory = path.join(dataDirectory, 'checkpoints');

function ensureStorage() {
  fs.mkdirSync(checkpointsDirectory, { recursive: true });
  if (!fs.existsSync(runsFile)) fs.writeFileSync(runsFile, '[]\n');
}

function readRuns() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(runsFile, 'utf8'));
  } catch {
    return [];
  }
}

function saveRun(run) {
  const runs = readRuns().filter((item) => item.runId !== run.runId);
  runs.unshift({ ...run, persistedAt: new Date().toISOString() });
  fs.writeFileSync(runsFile, `${JSON.stringify(runs.slice(0, 100), null, 2)}\n`);
}

function saveCheckpoint(runId, checkpoint) {
  ensureStorage();
  const destination = path.join(checkpointsDirectory, `${runId}.json`);
  fs.writeFileSync(destination, `${JSON.stringify({ ...checkpoint, savedAt: new Date().toISOString() }, null, 2)}\n`);
}

function clearCheckpoint(runId) {
  const destination = path.join(checkpointsDirectory, `${runId}.json`);
  if (fs.existsSync(destination)) fs.unlinkSync(destination);
}

function getRuns() {
  return readRuns().map(({ events, artifacts, memory, ...summary }) => summary);
}

function getRun(runId) {
  return readRuns().find((run) => run.runId === runId) || null;
}

module.exports = { clearCheckpoint, getRun, getRuns, saveCheckpoint, saveRun };
