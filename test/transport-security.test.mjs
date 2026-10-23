import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createHttpTransport, createCookieJar, HTTP_LIMITS } from '../src/providers/transport.mjs';
import { buildProviderRegistry } from '../src/core-host.mjs';
import { neteaseEndpoints } from '../src/providers/endpoints/netease.mjs';
import { createQQProvider } from '../src/providers/qq.mjs';

async function server(t, handler) {
  const seen = [];
  const listener = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, cookie: req.headers.cookie, body, headers: req.headers });
      handler(req, res);
    });
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { listener.closeAllConnections(); listener.close(resolve); }));
  return { origin: `http://127.0.0.1:${listener.address().port}`, seen };
}

function local(origin, endpoints, options = {}) {
  return createHttpTransport({ trustedOrigin: origin, allowInsecureLoopback: true, endpoints, ...options });
}

test('endpoint maps cannot grant trust, mix platforms or enable non-loopback HTTP', () => {
  for (const options of [
    { endpoints: { search: { url: 'https://music.163.com/api/search' } } },
    { trustedOrigin: 'https://music.163.com', endpoints: { search: { url: 'https://music.163.com.evil.invalid/search' } } },
    { trustedOrigin: 'https://music.163.com', endpoints: { search: { url: 'https://music.163.com/search' }, resolve: { url: 'https://y.qq.com/resolve' } } },
    { trustedOrigin: 'http://music.163.com', allowInsecureLoopback: true, endpoints: { search: { url: 'http://music.163.com/search' } } },
    { trustedOrigin: 'http://127.0.0.1', endpoints: { search: { url: 'http://127.0.0.1/search' } } },
    { trustedOrigin: 'https://music.163.com', endpoints: { search: { url: 'https://user:private@music.163.com/search' } } },
    { trustedOrigin: 'https://music.163.com/path', endpoints: {} },
  ]) assert.throws(() => createHttpTransport(options), { code: 'endpoint_untrusted' });
});

test('Core pins NetEase origin independently of endpoint configuration and leaves QQ without a production profile', () => {
  assert.throws(() => buildProviderRegistry({ adapters: { netease: {
    endpoints: neteaseEndpoints({ base: 'https://y.qq.com/api' }), trustedOrigin: 'https://y.qq.com',
  } } }), { code: 'endpoint_untrusted' });
  const registry = buildProviderRegistry({ adapters: { netease: { endpoints: neteaseEndpoints() } } });
  assert.equal(registry.has('netease'), true);
  assert.equal(registry.has('qq'), false);
});

test('a changed endpoint is revalidated before the first request, including cookie-free roles', async () => {
  let calls = 0;
  const endpoints = { search: { url: 'https://music.163.com/api/search', includeCookies: false } };
  const transport = createHttpTransport({ trustedOrigin: 'https://music.163.com', endpoints,
    fetchImpl: async () => { calls++; return Response.json({}); } });
  transport.useSecret('MUSIC_U=private-fixture');
  endpoints.search.url = 'https://y.qq.com/search';
  await assert.rejects(transport.request({ role: 'search' }), { code: 'endpoint_untrusted' });
  assert.equal(calls, 0);
});

test('same-origin redirects update cookies and follow POST-to-GET semantics', async t => {
  const s = await server(t, (req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/end', 'set-cookie': 'session=updated; Path=/' }); res.end();
    } else res.end('{"ok":true}');
  });
  const transport = local(s.origin, { search: { url: `${s.origin}/start`, body: () => ({ q: 'fixture' }) } });
  transport.useSecret('session=old-fixture');
  const result = await transport.request({ role: 'search' });
  assert.equal(result.body.ok, true);
  assert.equal(result.url, `${s.origin}/end`);
  assert.deepEqual(s.seen.map(row => [row.method, row.cookie]), [['POST', 'session=old-fixture'], ['GET', 'session=updated']]);
  assert.equal(s.seen[1].body, '');
  assert.equal(s.seen[1].headers['content-type'], undefined);
});

test('307 preserves a form body within the same origin and redirect loops are bounded', async t => {
  const s = await server(t, (req, res) => {
    if (req.url === '/end') return res.end('{}');
    res.writeHead(307, { location: req.url === '/loop' ? '/loop' : '/end' }); res.end();
  });
  const transport = local(s.origin, {
    resolve: { url: `${s.origin}/start`, body: () => ({ id: 42 }) },
    loop: { url: `${s.origin}/loop` },
  }, { maxRedirects: 2 });
  await transport.request({ role: 'resolve' });
  assert.deepEqual(s.seen.map(row => [row.method, row.body]), [['POST', 'id=42'], ['POST', 'id=42']]);
  await assert.rejects(transport.request({ role: 'loop' }), { code: 'redirect_limit' });
  assert.equal(s.seen.filter(row => row.url === '/loop').length, 3);
});

test('cross-origin redirects make no second request and cannot update the original jar', async t => {
  const target = await server(t, (_req, res) => res.end('{}'));
  const source = await server(t, (_req, res) => {
    res.writeHead(302, { location: `${target.origin}/sink?private=fixture`, 'set-cookie': 'session=untrusted-update; Path=/' }); res.end();
  });
  const logs = [];
  const transport = local(source.origin, { search: { url: source.origin } }, { onLog: entry => logs.push(entry) });
  transport.useSecret('session=private-fixture');
  await assert.rejects(transport.request({ role: 'search' }), error => {
    assert.equal(error.code, 'endpoint_untrusted');
    assert.equal(error.message.includes('private'), false); return true;
  });
  assert.equal(target.seen.length, 0);
  assert.equal(transport.jar.toSecret(), 'session=private-fixture');
  assert.equal(JSON.stringify(logs).includes('private'), false);
});

test('native Node fetch strips Cookie on a cross-origin port redirect (original leakage hypothesis is not confirmed)', async t => {
  const target = await server(t, (_req, res) => res.end('{}'));
  const source = await server(t, (_req, res) => { res.writeHead(302, { location: target.origin }); res.end(); });
  await (await fetch(source.origin, { headers: { cookie: 'session=synthetic-only' }, redirect: 'follow' })).text();
  assert.equal(source.seen[0].cookie, 'session=synthetic-only');
  assert.equal(target.seen.length, 1);
  assert.equal(target.seen[0].cookie, undefined);
});

test('injected fetch cannot cause an HTTPS downgrade, subdomain or port hop', async () => {
  for (const location of ['http://music.163.com/sink', 'https://sub.music.163.com/sink', 'https://music.163.com:444/sink', 'file:///private']) {
    const calls = [];
    const transport = createHttpTransport({ trustedOrigin: 'https://music.163.com', endpoints: neteaseEndpoints(),
      fetchImpl: async (url, options) => {
        calls.push({ url: url.toString(), options });
        return new Response(null, { status: 302, headers: { location } });
      } });
    transport.useSecret('MUSIC_U=fixture');
    await assert.rejects(transport.request({ role: 'search' }), { code: 'endpoint_untrusted' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.credentials, 'omit');
  }
});

test('unexpected auto-followed responses are rejected before cookie absorption', async () => {
  const response = Response.json({}, { headers: { 'set-cookie': 'session=wrong' } });
  Object.defineProperty(response, 'redirected', { value: true });
  const transport = createHttpTransport({ trustedOrigin: 'https://music.163.com', endpoints: neteaseEndpoints(), fetchImpl: async () => response });
  await assert.rejects(transport.request({ role: 'search' }), { code: 'redirect_blocked' });
  assert.equal(transport.jar.size(), 0);
});

test('Cookie Domain, Path, Secure, expiry and deletion cannot broaden a bound jar', () => {
  const jar = createCookieJar({ origin: 'https://music.163.com' });
  jar.absorb([
    'root=1; Domain=.163.com; Path=/; Secure; HttpOnly',
    'local=2; Path=/api', 'scoped=3',
    'foreign=bad; Domain=y.qq.com; Path=/',
    'expired=bad; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
  ], 'https://music.163.com/private/start');
  assert.equal(jar.header('https://music.163.com/api/song'), 'local=2; root=1');
  assert.equal(jar.header('https://music.163.com/apix'), 'root=1');
  assert.equal(jar.header('https://music.163.com/private/end'), 'scoped=3; root=1');
  assert.equal(jar.header('https://y.qq.com/api'), null);
  assert.equal(jar.header('https://sub.music.163.com/api'), null);
  jar.absorb(['local=; Path=/api; Max-Age=0'], 'https://music.163.com/api/update');
  assert.equal(jar.header('https://music.163.com/api'), 'root=1');
  assert.throws(() => jar.absorb(['root=bad'], 'https://y.qq.com'), { code: 'endpoint_untrusted' });
  const httpJar = createCookieJar({ origin: 'http://127.0.0.1' });
  httpJar.absorb(['secure=1; Secure; Path=/', 'plain=1; Path=/']);
  assert.equal(httpJar.header(), 'plain=1');
});

test('cookies stay isolated between separate platform transports', async () => {
  const calls = [];
  for (const [origin, secret] of [['https://music.163.com', 'MUSIC_U=netease-fixture'], ['https://y.qq.com', 'qqmusic_key=qq-fixture']]) {
    const transport = createHttpTransport({ trustedOrigin: origin, endpoints: { search: { url: `${origin}/search` } },
      fetchImpl: async (_url, options) => { calls.push(options.headers.get('cookie')); return Response.json({}); } });
    transport.useSecret(secret);
    await transport.request({ role: 'search' });
  }
  assert.deepEqual(calls, ['MUSIC_U=netease-fixture', 'qqmusic_key=qq-fixture']);
});

test('cookie-free roles neither send, absorb nor expose a stored session', async t => {
  const s = await server(t, (_req, res) => {
    res.setHeader('set-cookie', 'session=unexpected; Path=/'); res.end('{}');
  });
  const transport = local(s.origin, { public: { url: s.origin, includeCookies: false } });
  transport.useSecret('session=old-fixture');
  const result = await transport.request({ role: 'public' });
  assert.equal(s.seen[0].cookie, undefined);
  assert.equal(result.cookies, ''); assert.equal(result.body.cookie, undefined);
  assert.equal(transport.jar.toSecret(), 'session=old-fixture');
});

test('case-insensitive descriptor credential headers cannot bypass cookie policies', async () => {
  for (const header of ['Cookie', 'cOoKiE', 'Authorization', 'Proxy-Authorization', 'Cookie2', 'Host']) {
    let calls = 0;
    const transport = createHttpTransport({ trustedOrigin: 'https://music.163.com',
      endpoints: { search: { url: 'https://music.163.com', includeCookies: false, headers: { [header]: 'private-fixture' } } },
      fetchImpl: async () => { calls++; return Response.json({}); } });
    await assert.rejects(transport.request({ role: 'search' }), { code: 'endpoint_untrusted' });
    assert.equal(calls, 0);
  }
});

test('legacy QR requests never borrow the previous account or key-response cookies', async t => {
  const s = await server(t, (req, res) => {
    if (req.url.startsWith('/key')) res.setHeader('set-cookie', 'guest=key-only; Path=/');
    if (req.url.startsWith('/confirmed')) res.setHeader('set-cookie', 'MUSIC_U=new-fixture; Path=/');
    res.end(req.url.startsWith('/key') ? '{"code":200}' : '{"code":803}');
  });
  const endpoints = { loginQr: { url: `${s.origin}/key` }, loginPoll: { url: `${s.origin}/poll` } };
  const transport = local(s.origin, endpoints);
  transport.useSecret('MUSIC_U=old-fixture');
  await transport.request({ role: 'loginQr' });
  const empty = await transport.request({ role: 'loginPoll' });
  assert.equal(empty.body.cookie, undefined); assert.equal(empty.cookies, '');
  endpoints.loginPoll.url = `${s.origin}/confirmed`;
  const confirmed = await transport.request({ role: 'loginPoll' });
  assert.equal(confirmed.body.cookie, 'MUSIC_U=new-fixture');
  assert.equal(s.seen.every(row => row.cookie === undefined), true);
  assert.equal(transport.jar.toSecret(), 'MUSIC_U=old-fixture');
});

test('shared platform login cannot authorize from a previous jar when the new scan has no session', async () => {
  let writes = 0;
  const provider = createQQProvider({ credentials: { write: () => writes++ },
    transport: { jar: { toSecret: () => 'qqmusic_key=old-fixture' },
      request: async ({ role }) => ({ body: role === 'loginQr' ? { key: 'fixture' } : { code: 0 } }) } });
  await provider.beginLogin();
  await assert.rejects(provider.pollLogin(), { code: 'provider_failure' });
  assert.equal(writes, 0);
});

test('streamed, declared and decompressed large responses fail without updating cookies', async t => {
  const large = '中'.repeat(100);
  const s = await server(t, (req, res) => {
    res.setHeader('set-cookie', 'session=not-committed; Path=/');
    if (req.url === '/declared') res.setHeader('content-length', Buffer.byteLength(large));
    if (req.url === '/gzip') res.setHeader('content-encoding', 'gzip');
    if (req.url === '/stream') { res.write(large.slice(0, 20)); res.end(large.slice(20)); }
    else res.end(req.url === '/gzip' ? gzipSync(large) : large);
  });
  const transport = local(s.origin, Object.fromEntries(['stream', 'declared', 'gzip'].map(role => [role, { url: `${s.origin}/${role}` }])), { maxResponseBytes: 64 });
  transport.useSecret('session=old-fixture');
  for (const role of transport.roles()) {
    await assert.rejects(transport.request({ role }), { code: 'response_too_large' });
    assert.equal(transport.jar.toSecret(), 'session=old-fixture');
  }
});

test('Cookie size bounds cover loaded secrets, response headers, JSON cookie fields and accumulated paths', async () => {
  const jar = createCookieJar({ maxBytes: 40 });
  jar.absorb('a=first');
  assert.throws(() => jar.absorb('b=' + 'x'.repeat(41)), { code: 'cookie_too_large' });
  assert.equal(jar.header(), 'a=first');
  assert.throws(() => jar.absorb('b=bad\r\nvalue'), { code: 'invalid_cookie' });
  const scoped = createCookieJar({ origin: 'https://music.163.com', maxBytes: 40 });
  scoped.absorb(['a=1; Path=/a']); scoped.absorb(['b=2; Path=/b']);
  assert.throws(() => scoped.absorb(['c=' + 'x'.repeat(24) + '; Path=/c']), { code: 'cookie_too_large' });
  assert.equal(scoped.size(), 2);
  for (const response of [
    Response.json({}, { headers: { 'set-cookie': 'MUSIC_U=' + 'x'.repeat(100) } }),
    Response.json({ cookie: 'MUSIC_U=' + 'x'.repeat(100) }),
  ]) {
    const transport = createHttpTransport({ trustedOrigin: 'https://music.163.com', endpoints: neteaseEndpoints(), maxCookieBytes: 64,
      fetchImpl: async () => response });
    await assert.rejects(transport.request({ role: 'search' }), { code: 'cookie_too_large' });
    assert.equal(transport.jar.size(), 0);
  }
  assert.equal(HTTP_LIMITS.responseBytes, 4 * 1024 * 1024);
  assert.equal(HTTP_LIMITS.cookieBytes, 16 * 1024);
});

test('fetch errors and logs discard upstream secrets and query strings', async () => {
  const logs = [];
  const transport = createHttpTransport({ trustedOrigin: 'https://music.163.com', endpoints: neteaseEndpoints(),
    onLog: entry => logs.push(entry), fetchImpl: async () => { throw new Error('Cookie=MUSIC_U=private-value https://music.163.com/?key=private'); } });
  await assert.rejects(transport.request({ role: 'search' }), error => {
    assert.equal(error.code, 'ECONNRESET');
    assert.equal(String(error).includes('private'), false);
    assert.equal(error.cause, undefined); return true;
  });
  assert.equal(JSON.stringify(logs).includes('private'), false);
});

test('CLI diagnostic endpoints cannot receive persisted credentials or use a remote override', () => {
  for (const [base, args] of [
    ['http://127.0.0.1:1/api', []], ['https://evil.invalid/api', ['--dry-run']],
    ['not-a-url?key=private-fixture', ['--dry-run']], ['http://user:private-fixture@127.0.0.1/api', ['--dry-run']],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/login.mjs', ...args], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, FISHFM_NETEASE_BASE: base },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires --dry-run and an IP loopback URL/);
    assert.equal(result.stderr.includes('private-fixture'), false);
  }
});
