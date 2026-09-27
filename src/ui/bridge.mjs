// The UI bridge: how the desktop panel observes the core and sends it commands.
//
// ARCHITECTURE fixes the rules this implements:
//   - a reconnect takes a snapshot first, then consumes only newer revisions, so
//     an old state is never replayed onto a fresh window (line 66);
//   - a UI failure affects display only: the bridge never mutates core state, and
//     losing the connection must leave the music exactly as it was (line 81);
//   - whatever the transport, it needs a protocol version, a disconnect snapshot
//     and an exit notification (line 115).
//
// The transport is injected, so the same logic serves a local socket, a pipe or
// an in-process pair, and every rule above is testable without a desktop shell.

/** Bumped when the envelope shape changes; a mismatch is refused, not guessed. */
export const UI_BRIDGE_PROTOCOL = 1;

export const BRIDGE_STATUSES = Object.freeze(['idle', 'connecting', 'connected', 'reconnecting', 'incompatible', 'closed', 'failed']);

function defaultBackoff(attempt) {
  // Bounded and gentle: a desktop panel should not hammer a busy host.
  return Math.min(200 * 2 ** (attempt - 1), 5000);
}

/**
 * @param {object} options
 * @param {object} options.transport `connect()`, `send(line)`, `close()`, `onMessage`, `onClose`
 * @param {Function} [options.now]
 * @param {object} [options.reconnect] `{ maxAttempts, backoff }`
 * @param {object} [options.session]   MusicStore, for remembering the window
 */
export function createUiBridge({
  transport,
  now = () => Date.now(),
  reconnect = {},
  onState = () => {},
  onStatus = () => {},
  protocol = UI_BRIDGE_PROTOCOL,
} = {}) {
  if (!transport || typeof transport.connect !== 'function') {
    throw new Error('A transport with connect()/send()/close() is required');
  }
  const maxAttempts = reconnect.maxAttempts ?? 5;
  const backoff = reconnect.backoff ?? defaultBackoff;

  let status = 'idle';
  let revision = -1;
  let snapshot = null;
  let attempts = 0;
  let closedByUs = false;
  const pending = new Map();
  const counters = { staleStates: 0, states: 0, reconnects: 0, refused: 0, disconnects: 0 };
  let nextCommandId = 0;

  const setStatus = (next, detail = null) => {
    if (status === next && detail === null) return;
    status = next;
    onStatus({ status: next, detail, attempts, revision, at: now() });
  };

  const bridge = {
    protocol,
    get status() { return status; },
    get revision() { return revision; },
    get snapshot() { return snapshot; },
    get counters() { return { ...counters }; },
    get attempts() { return attempts; },

    /** Connects and asks for a snapshot; safe to call again after a failure. */
    async connect() {
      closedByUs = false;
      setStatus(attempts > 0 ? 'reconnecting' : 'connecting');
      try {
        await transport.connect();
      } catch (error) {
        counters.refused += 1;
        setStatus('failed', `could not connect: ${error.message}`);
        return { connected: false, status, reason: error.message };
      }
      // A fresh window must not inherit whatever it last displayed.
      bridge.requestSnapshot();
      return { connected: true, status };
    },

    /** Asks the core for an authoritative snapshot. */
    requestSnapshot() {
      bridge.send({ type: 'snapshot' });
      return true;
    },

    /**
     * Sends a command and resolves with its answer.
     * A UI that cannot reach the core gets a refusal; it never blocks forever.
     */
    send(message) {
      const envelope = { v: protocol, id: message.id ?? `ui-${++nextCommandId}`, ...message };
      try {
        transport.send(JSON.stringify(envelope));
      } catch (error) {
        // A dead transport is a display problem: report it, do not throw into
        // whatever the UI was doing.
        setStatus('failed', `send failed: ${error.message}`);
        return null;
      }
      if (message.type === 'command' || message.type === 'snapshot') {
        return new Promise((resolve) => pending.set(envelope.id, resolve));
      }
      return null;
    },

    async command(command) {
      const answer = bridge.send({ type: 'command', command });
      if (!answer) return { ok: false, error: { code: 'ui_disconnected', message: 'the panel is not connected' } };
      return answer;
    },

    /**
     * Feeds one line from the core. Returns what it did, which is what makes
     * "an old revision is not replayed" observable rather than assumed.
     */
    handleMessage(raw) {
      let envelope = raw;
      if (typeof raw === 'string') {
        try {
          envelope = JSON.parse(raw);
        } catch {
          return { ignored: true, reason: 'not json' };
        }
      }
      if (!envelope || typeof envelope !== 'object') return { ignored: true, reason: 'not an envelope' };

      if (envelope.type === 'hello' || envelope.type === 'ready') {
        // The host greets with `ready`; `hello` is accepted too so the same
        // bridge works against either spelling.
        const spoken = envelope.protocol ?? envelope.v ?? protocol;
        if (spoken !== protocol) {
          // Refuse rather than misinterpret: a version mismatch is a real
          // incompatibility, not something to muddle through.
          setStatus('incompatible', `core speaks protocol ${spoken}, this panel speaks ${protocol}`);
          return { ignored: true, reason: 'protocol mismatch', compatible: false };
        }
        attempts = 0;
        setStatus('connected');
        // The greeting carries an initial snapshot, so the panel can render
        // immediately instead of waiting for the first change.
        if (envelope.snapshot) {
          return { ...bridge.handleMessage({ type: 'state', snapshot: envelope.snapshot, revision: envelope.snapshot.revision }), kind: 'ready' };
        }
        return { accepted: true, kind: 'ready' };
      }

      if (envelope.type === 'state') {
        const body = envelope.snapshot ?? envelope.state ?? null;
        // The host carries the revision inside the snapshot rather than on the
        // envelope, so read it from either place: the staleness rule depends on
        // finding it.
        const incoming = Number.isFinite(envelope.revision)
          ? envelope.revision
          : (Number.isFinite(body?.revision) ? body.revision : null);
        if (incoming !== null && incoming <= revision) {
          // Older than what is displayed: dropping it is the whole point of
          // tracking a revision.
          counters.staleStates += 1;
          return { accepted: false, reason: 'stale revision', revision, incoming };
        }
        revision = incoming ?? revision;
        snapshot = body;
        counters.states += 1;
        onState({ snapshot, revision, reason: envelope.reason ?? null, at: now() });
        return { accepted: true, kind: 'state', revision };
      }

      if (envelope.type === 'result' || envelope.type === 'error') {
        const settle = pending.get(envelope.id);
        if (settle) {
          pending.delete(envelope.id);
          settle(envelope);
        }
        return { accepted: true, kind: envelope.type };
      }

      if (envelope.type === 'exiting') {
        // The core said goodbye: reconnecting would be wrong.
        closedByUs = true;
        setStatus('closed', 'the music service is shutting down');
        return { accepted: true, kind: 'exiting' };
      }

      return { ignored: true, reason: `unknown type ${envelope.type}` };
    },

    /**
     * The transport dropped. Re-asks for a snapshot once reconnected, so the
     * panel shows the current truth rather than replaying what it had.
     */
    async handleDisconnect(reason = 'transport closed') {
      counters.disconnects += 1;
      // Anything still waiting will never be answered.
      for (const [id, settle] of pending) {
        pending.delete(id);
        settle({ type: 'error', id, error: { code: 'ui_disconnected', message: reason } });
      }
      if (closedByUs) return { reconnect: false, reason: 'closed on purpose' };
      if (status === 'incompatible') return { reconnect: false, reason: 'protocol mismatch' };
      if (attempts >= maxAttempts) {
        setStatus('failed', `gave up after ${attempts} attempts`);
        return { reconnect: false, reason: 'attempts exhausted' };
      }
      attempts += 1;
      counters.reconnects += 1;
      setStatus('reconnecting', reason);
      return { reconnect: true, attempt: attempts, delayMs: backoff(attempts) };
    },

    /** Closes deliberately: no reconnect follows. */
    close() {
      closedByUs = true;
      try {
        transport.close();
      } catch { /* already gone */ }
      setStatus('closed', 'closed by the panel');
      return true;
    },
  };

  return bridge;
}

/**
 * The panel's side of the conversation with an in-process core, used by tests and
 * by a single-process deployment where no socket is needed.
 */
export function createMemoryTransport({ core = null } = {}) {
  let handler = null;
  let closed = false;
  const sent = [];
  return {
    sent,
    get closed() { return closed; },
    onMessage(fn) { handler = fn; },
    async connect() { closed = false; },
    send(line) {
      if (closed) throw new Error('transport is closed');
      sent.push(line);
      if (core?.handle) {
        // Answer asynchronously, like a real transport would.
        Promise.resolve()
          .then(() => core.handle(JSON.parse(line)))
          .then((answers) => {
            for (const answer of Array.isArray(answers) ? answers : [answers]) {
              if (answer) handler?.(typeof answer === 'string' ? answer : JSON.stringify(answer));
            }
          })
          .catch(() => { /* the bridge reports its own failures */ });
      }
    },
    deliver(message) { handler?.(typeof message === 'string' ? message : JSON.stringify(message)); },
    close() { closed = true; },
    failNextConnect(error = new Error('refused')) { this.connect = async () => { throw error; }; },
  };
}