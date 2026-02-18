const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 3333;
const DIR = path.resolve(__dirname);
const OPENCLAW = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';

// --- Input Validation ---
const VALID_JOB_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_SESSION_ID = /^[0-9a-f-]{36}$/i;
const VALID_AGENT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_THINKING = /^(off|minimal|low|medium|high)$/;

function validateParam(value, regex, name) {
  if (!value || !regex.test(value)) {
    return { valid: false, error: `Invalid ${name}` };
  }
  return { valid: true };
}

// --- CORS ---
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3333',
  'http://127.0.0.1:3333'
]);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function runCli(args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile(OPENCLAW, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ raw: stdout.trim() });
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  // --- API Routes ---

  if (urlPath === '/api/status' && req.method === 'GET') {
    try {
      const data = await runCli(['status', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/health' && req.method === 'GET') {
    try {
      const data = await runCli(['gateway', 'call', 'health', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/cron' && req.method === 'GET') {
    try {
      const data = await runCli(['cron', 'list', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/sessions' && req.method === 'GET') {
    try {
      const data = await runCli(['sessions', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // --- New read-only endpoints ---

  if (urlPath === '/api/agents' && req.method === 'GET') {
    try {
      const data = await runCli(['agents', 'list', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/skills' && req.method === 'GET') {
    try {
      const data = await runCli(['skills', 'list', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/cron/status' && req.method === 'GET') {
    try {
      const data = await runCli(['cron', 'status', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/logs' && req.method === 'GET') {
    try {
      const data = await runCli(['logs', '--json', '--limit', '50']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/channels' && req.method === 'GET') {
    try {
      const data = await runCli(['channels', 'list', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/models' && req.method === 'GET') {
    try {
      const data = await runCli(['models', 'list', '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // Cron runs history (must be before regex-based cron routes)
  const cronRunsMatch = urlPath.match(/^\/api\/cron\/([^/]+)\/runs$/);
  if (cronRunsMatch && req.method === 'GET') {
    const jobId = cronRunsMatch[1];
    const check = validateParam(jobId, VALID_JOB_ID, 'job ID');
    if (!check.valid) {
      sendJson(res, 400, { error: check.error });
      return;
    }
    try {
      const data = await runCli(['cron', 'runs', '--id', jobId, '--json', '--limit', '20']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // --- Existing mutating cron routes (with validation) ---

  const cronRunMatch = urlPath.match(/^\/api\/cron\/([^/]+)\/run$/);
  if (cronRunMatch && req.method === 'POST') {
    const jobId = cronRunMatch[1];
    const check = validateParam(jobId, VALID_JOB_ID, 'job ID');
    if (!check.valid) {
      sendJson(res, 400, { error: check.error });
      return;
    }
    try {
      const data = await runCli(['cron', 'run', jobId, '--expect-final', '--timeout', '60000'], 65000);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  const cronToggleMatch = urlPath.match(/^\/api\/cron\/([^/]+)\/(enable|disable)$/);
  if (cronToggleMatch && req.method === 'POST') {
    const jobId = cronToggleMatch[1];
    const action = cronToggleMatch[2];
    const check = validateParam(jobId, VALID_JOB_ID, 'job ID');
    if (!check.valid) {
      sendJson(res, 400, { error: check.error });
      return;
    }
    try {
      const data = await runCli(['cron', action, jobId]);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  const cronDeleteMatch = urlPath.match(/^\/api\/cron\/([^/]+)$/);
  if (cronDeleteMatch && req.method === 'DELETE') {
    const jobId = cronDeleteMatch[1];
    const check = validateParam(jobId, VALID_JOB_ID, 'job ID');
    if (!check.valid) {
      sendJson(res, 400, { error: check.error });
      return;
    }
    try {
      const data = await runCli(['cron', 'rm', jobId, '--json']);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // --- Agent message (with validation + thinking support) ---

  if (urlPath === '/api/agent/message' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
      return;
    }
    const { message, sessionId, agentId, thinking } = body;
    if (!message) {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }
    if (sessionId) {
      const check = validateParam(sessionId, VALID_SESSION_ID, 'session ID');
      if (!check.valid) {
        sendJson(res, 400, { error: check.error });
        return;
      }
    }
    if (agentId) {
      const check = validateParam(agentId, VALID_AGENT_ID, 'agent ID');
      if (!check.valid) {
        sendJson(res, 400, { error: check.error });
        return;
      }
    }
    const args = ['agent', '--message', message, '--json'];
    if (sessionId) {
      args.push('--session-id', sessionId);
    }
    if (agentId) {
      args.push('--agent', agentId);
    }
    if (thinking && VALID_THINKING.test(thinking)) {
      args.push('--thinking', thinking);
    }
    args.push('--timeout', '120');
    try {
      const data = await runCli(args, 130000);
      sendJson(res, 200, data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // --- Static Files ---

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  // Path traversal protection
  const normalized = path.normalize(urlPath === '/' ? '/index.html' : urlPath);
  const fullPath = path.resolve(DIR, '.' + normalized);
  if (!fullPath.startsWith(DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    if (ext === '.json') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// --- Startup health check ---
try {
  fs.accessSync(OPENCLAW, fs.constants.X_OK);
} catch {
  console.error(`\nFATAL: CLI binary not found or not executable at: ${OPENCLAW}`);
  console.error('Set OPENCLAW_BIN environment variable to the correct path.\n');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ⚡ BEDDAN COMMAND CENTER                                ║
║                                                           ║
║   Live at: http://localhost:${PORT}                         ║
║   Gateway: ws://127.0.0.1:18789                           ║
║                                                           ║
║   API Endpoints:                                          ║
║     GET  /api/status            Gateway status             ║
║     GET  /api/health            Channel health             ║
║     GET  /api/cron              Cron jobs                  ║
║     GET  /api/cron/status       Scheduler state            ║
║     GET  /api/cron/:id/runs     Run history                ║
║     GET  /api/sessions          Active sessions            ║
║     GET  /api/agents            List agents                ║
║     GET  /api/skills            Available skills           ║
║     GET  /api/logs              Gateway logs               ║
║     GET  /api/channels          Channel info               ║
║     GET  /api/models            Available models           ║
║     POST /api/cron/:id/run      Trigger cron job           ║
║     POST /api/agent/message     Send agent message         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// --- Graceful shutdown ---
function shutdown() {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
