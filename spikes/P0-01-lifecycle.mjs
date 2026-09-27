// Minimal DSH lifecycle probe. It logs only event types, never event payloads.
export const name = 'fishfm-p0-lifecycle';

export function apply(ctx) {
  console.log('FISHFM_P0_APPLY');
  ctx.on('session/event', (event) => {
    console.log(`FISHFM_P0_EVENT:${String(event?.type ?? 'unknown')}`);
  });
  ctx.effect(() => {
    return () => console.log('FISHFM_P0_DISPOSE');
  });
}
