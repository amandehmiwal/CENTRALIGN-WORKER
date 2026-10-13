const http = require('http');
const fs = require('fs');
const path = require('path');
const { evaluateSuite, getRun, getRuns, getState, resetState, resumeRun, runWorker } = require('./worker');

const publicDirectory = path.join(__dirname, 'public');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(Error('Request body must contain valid JSON.'));
      }
    });
  });
}

function serveStaticFile(urlPath, response) {
  const requestedPath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const fullPath = path.resolve(publicDirectory, requestedPath);

  if (!fullPath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (error, file) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': contentTypes[path.extname(fullPath)] || 'text/plain; charset=utf-8'
    });
    response.end(file);
  });
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/api/state') {
    sendJson(response, 200, getState());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/runs') {
    sendJson(response, 200, getRuns());
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
    const run = getRun(url.pathname.split('/').pop());
    sendJson(response, run ? 200 : 404, run || { error: 'Run not found.' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/reset') {
    resetState();
    sendJson(response, 200, getState());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run') {
    try {
      const input = await readJsonBody(request);
      sendJson(response, 200, await runWorker(input.task, input.options || {}));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/resume')) {
    try {
      const input = await readJsonBody(request);
      const runId = url.pathname.split('/')[3];
      sendJson(response, 200, await resumeRun(runId, Boolean(input.approved)));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/evaluate') {
    sendJson(response, 200, await evaluateSuite());
    return;
  }

  serveStaticFile(url.pathname, response);
}).listen(process.env.PORT || 3000, () => {
  console.log('Centra Worker running at http://localhost:3000');
});
