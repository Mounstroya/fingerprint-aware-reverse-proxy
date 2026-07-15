const { test } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

test('GET /health returns ok status', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('POST /target-api without a session is rejected', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/target-api/some/path`, { method: 'POST' });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});
