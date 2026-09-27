// Minimal DSH lifecycle probe. It logs only event types and outcomes, never payloads.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const name = 'fishfm-p0-lifecycle';
export const inject = ['sessions', 'tools', 'credentials'];

function dpapi(operation, input) {
  return new Promise((resolve, reject) => {
    const helper = spawn('pwsh', [
      '-NoProfile', '-File', fileURLToPath(new URL('P0-06-dpapi.ps1', import.meta.url)),
      '-Operation', operation,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (chunk) => { output += chunk; });
    helper.stderr.resume();
    helper.once('error', reject);
    helper.once('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`DPAPI helper exited ${code}`));
    });
    helper.stdin.end(input);
  });
}

export function apply(ctx) {
  const delayMs = Number(process.env.FISHFM_P0_DELAY_MS ?? 3000);
  console.log('FISHFM_P0_APPLY');
  ctx.on('session/event', (_session, event) => {
    console.log(`FISHFM_P0_EVENT:${String(event?.type ?? 'unknown')}`);
  });

  let sendCore;
  ctx.effect(() => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/fishfm-debug.mjs', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    console.log(`FISHFM_P0_CHILD_PID:${child.pid}`);
    let buffer = '';
    let ready = false;
    const pending = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (!ready) {
          ready = true;
          console.log('FISHFM_P0_CHILD_READY');
        } else {
          pending.shift()?.(parsed);
        }
      }
    });
    child.stderr.resume();
    sendCore = (command) => new Promise((resolve, reject) => {
      if (!ready || child.exitCode !== null) return reject(new Error('Core child is unavailable'));
      pending.push(resolve);
      child.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) reject(error);
      });
    });
    return () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timeout = setTimeout(() => child.kill(), 3000);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        console.log(`FISHFM_P0_CHILD_EXIT:${code}`);
        resolve();
      });
      child.stdin.write('exit\n');
    });
  });

  ctx.tools.register({
    name: 'fishfm_probe',
    description: 'Probe a slow local music command without contacting a music service.',
    parameters: {
      type: 'object', properties: { action: { type: 'string', enum: ['pause'] } },
      required: ['action'], additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object', properties: { accepted: { type: 'boolean' } },
        required: ['accepted'], additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      console.log('FISHFM_P0_TOOL_START');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const response = await sendCore({ type: args.action, commandId: 'fishfm-p0-pause' });
      console.log('FISHFM_P0_TOOL_END');
      return { accepted: response?.snapshot?.paused === true && !exec.signal.aborted };
    },
  });

  ctx.effect(() => {
    const timer = setTimeout(async () => {
      try {
        const session = ctx.sessions.create();
        session.append('turn/start', { turn: 1 });
        const key = 'fishfm-p0-lifecycle/netease';
        try {
          const marker = 'synthetic-only';
          const ciphertext = await dpapi('protect', marker);
          await ctx.credentials.modifyRecord(key, async () => ({
            kind: 'grant', payload: { format: 'dpapi-current-user-v1', ciphertext },
          }));
          const record = await ctx.credentials.readRecord(key);
          const restored = await dpapi('unprotect', record?.payload?.ciphertext ?? '');
          console.log(`FISHFM_P0_CREDENTIAL_READ:${record?.kind === 'grant' && restored === marker}`);
          console.log(`FISHFM_P0_CREDENTIAL_CIPHER_ONLY:${!JSON.stringify(record).includes(marker)}`);
        } finally {
          await ctx.credentials.deleteRecord(key);
          const absent = await ctx.credentials.readRecord(key);
          console.log(`FISHFM_P0_CREDENTIAL_REMOVED:${absent === undefined}`);
        }
        const result = await ctx.tools.execute({
          callId: 'fishfm-p0-call', name: 'fishfm_probe',
          arguments: { action: 'pause' }, signal: AbortSignal.timeout(delayMs + 2000),
        });
        console.log(`FISHFM_P0_TOOL_RESULT:${result.isError ? 'error' : 'ok'}`);
      } catch (error) {
        console.log(`FISHFM_P0_PROBE_ERROR:${String(error?.code ?? error?.name ?? 'unknown')}`);
      }
    }, 0);
    return () => clearTimeout(timer);
  });
  ctx.effect(() => {
    return () => console.log('FISHFM_P0_DISPOSE');
  });
}
