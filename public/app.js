const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value) => String(value).replace(/[&<>]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;'
}[character]));

async function refreshEnvironment() {
  const state = await fetch('/api/state').then((response) => response.json());
  $('#files').textContent = `${state.workspace.fileCount} files`;
  $('#ledger').textContent = `${state.ledger.length} ${state.ledger.length === 1 ? 'entry' : 'entries'}`;
}

function statusClass(status) {
  return {
    completed: 'success',
    needs_approval: 'warning',
    needs_clarification: 'warning',
    failed: 'danger'
  }[status] || 'neutral';
}

function renderEvent(event, index) {
  const marker = event.kind === 'failure' ? '!' : event.kind === 'verification' ? '✓' : index + 1;
  const time = new Date(event.at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return `
    <article class="event ${event.kind}">
      <div class="dot">${marker}</div>
      <div>
        <div class="eventhead"><b>${escapeHtml(event.title)}</b><span>${time}</span></div>
        <p>${escapeHtml(event.detail)}</p>
      </div>
    </article>`;
}

function renderArtifact(artifact) {
  const icon = artifact.type === 'source_file' ? '▣' : '✓';
  return `
    <div class="artifact">
      <span>${icon}</span>
      <div><b>${escapeHtml(artifact.label)}</b><small>${escapeHtml(artifact.detail)}</small></div>
    </div>`;
}

function renderRun(output) {
  const trace = output.events.map(renderEvent).join('');
  const evidence = output.artifacts.length
    ? `<div class="artifacts"><label>EVIDENCE</label>${output.artifacts.map(renderArtifact).join('')}</div>`
    : '';
  const approval = output.status === 'needs_approval'
    ? '<button class="approve" id="approve">Approve & continue →</button>'
    : '';

  $('#runview').innerHTML = `
    <div class="result">
      <div class="resulttop">
        <div>
          <label>RUN ${escapeHtml(output.runId)}</label>
          <h2><span class="badge ${statusClass(output.status)}">${escapeHtml(output.status.replace('_', ' '))}</span> ${escapeHtml(output.summary)}</h2>
        </div>
      </div>
      ${approval}
      ${evidence}
      <div class="timeline">
        <label>EXECUTION TRACE · ${output.events.length} EVENTS</label>
        ${trace}
      </div>
    </div>`;

  const approveButton = $('#approve');
  if (approveButton) approveButton.onclick = () => resumeSavedRun(output.runId);
}

async function executeTask(approved = false) {
  const runButton = $('#run');
  runButton.disabled = true;
  runButton.innerHTML = 'Worker is executing <span class="spinner">↻</span>';
  $('#runview').innerHTML = '<div class="working"><div class="loader"></div><h2>Thinking, acting, and checking…</h2><p>The worker is using its constrained tools in the approved workspace.</p></div>';

  try {
    const output = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: $('#task').value, options: { approved } })
    }).then((response) => response.json());

    if (output.error) throw Error(output.error);
    renderRun(output);
    await refreshEnvironment();
  } catch (error) {
    $('#runview').innerHTML = `<div class="empty"><h2>Run failed</h2><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = 'Run autonomous worker <span>→</span>';
  }
}

async function resumeSavedRun(runId) {
  $('#runview').innerHTML = '<div class="working"><div class="loader"></div><h2>Resuming approved run…</h2><p>The worker is replaying the saved task with the newly granted approval.</p></div>';
  try {
    const output = await fetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true })
    }).then((response) => response.json());
    if (output.error) throw Error(output.error);
    renderRun(output);
    await refreshEnvironment();
  } catch (error) {
    $('#runview').innerHTML = `<div class="empty"><h2>Resume failed</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function showHistory() {
  const runs = await fetch('/api/runs').then((response) => response.json());
  const rows = runs.length
    ? runs.map((run) => `<article class="event"><div class="dot">↻</div><div><div class="eventhead"><b>${escapeHtml(run.summary)}</b><span>${escapeHtml(run.status)}</span></div><p>${escapeHtml(run.runId)} · ${new Date(run.persistedAt).toLocaleString()}</p></div></article>`).join('')
    : '<p>No saved runs yet.</p>';
  $('#runview').innerHTML = `<div class="result"><label>PERSISTED RUN HISTORY</label><div class="timeline">${rows}</div></div>`;
}

async function runEvaluation() {
  $('#runview').innerHTML = '<div class="working"><div class="loader"></div><h2>Running evaluation suite…</h2><p>Five deterministic scenarios are checking grounded answers, retry, approval, browser execution, and safe ambiguity.</p></div>';
  const report = await fetch('/api/evaluate', { method: 'POST' }).then((response) => response.json());
  const rows = report.results.map((result) => `<article class="event ${result.passed ? 'verification' : 'failure'}"><div class="dot">${result.passed ? '✓' : '!'}</div><div><div class="eventhead"><b>${escapeHtml(result.name)}</b><span>${result.passed ? 'PASS' : 'FAIL'}</span></div><p>Expected: ${escapeHtml(result.expected)} · Actual: ${escapeHtml(result.actual)}</p></div></article>`).join('');
  $('#runview').innerHTML = `<div class="result"><label>EVALUATION REPORT</label><h2>${report.passed}/${report.total} scenarios passed</h2><div class="timeline">${rows}</div></div>`;
  await refreshEnvironment();
}

$('#run').onclick = () => executeTask();
$('#history').onclick = () => showHistory();
$('#evaluate').onclick = () => runEvaluation();
$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  await refreshEnvironment();
  $('#runview').innerHTML = '<div class="empty"><div class="orb">✦</div><h2>Ledger reset</h2><p>Your approved workspace files remain unchanged.</p></div>';
};

document.querySelectorAll('[data-task]').forEach((example) => {
  example.onclick = () => { $('#task').value = example.dataset.task; };
});

refreshEnvironment();
