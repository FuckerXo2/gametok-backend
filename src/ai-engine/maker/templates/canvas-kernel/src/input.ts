// @ts-nocheck
// input.ts — canonical mobile controls. Two things builders ALWAYS get wrong hand-rolling these:
//   1. Joystick Y is INVERTED — screen-Y grows DOWNWARD, so "push up" gives a negative dy. This helper
//      returns UP = +y, so read stick.y as forward/up DIRECTLY. Never flip it yourself.
//   2. Touch scrolls the page / the control "sometimes doesn't work" — handled here via pointer events
//      + preventDefault + touch-action:none + pointer capture.
// ALSO use createButton for the RESULT-screen "Play Again" — a real tappable element that always fires,
// instead of a canvas-drawn button with hand-rolled hit-detection (the #1 dead-restart-button bug).
//
// Usage:
//   const stick = createJoystick();                 // bottom-left virtual stick
//   // each frame:  vx = stick.x * speed;  vy = -stick.y * speed;  // stick.y is UP (+); screen down is +y
//   const jump = createButton('JUMP', { side: 'right' });   if (jump.justPressed()) doJump();
//   createButton('Play Again', { wide: true, onTap: () => resetGame() });   // reliable restart

export function createJoystick(opts: any = {}) {
  const { side = 'left', size = 128, deadZone = 0.14, color = '#ffffff' } = opts;
  const state: any = { x: 0, y: 0, mag: 0, angle: 0, active: false };
  const R = size / 2;
  const base = document.createElement('div');
  const knob = document.createElement('div');
  Object.assign(base.style, { position: 'fixed', bottom: '28px', [side]: '28px', width: size + 'px', height: size + 'px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.25)', touchAction: 'none', zIndex: '50', userSelect: 'none' });
  Object.assign(knob.style, { position: 'absolute', left: '50%', top: '50%', width: (size * 0.45) + 'px', height: (size * 0.45) + 'px', marginLeft: -(size * 0.225) + 'px', marginTop: -(size * 0.225) + 'px', borderRadius: '50%', background: color, opacity: '0.55', pointerEvents: 'none' });
  base.appendChild(knob); document.body.appendChild(base);
  base.dataset.gtJoystick = '1'; // sandbox marker: lets acceptance drive + verify the stick

  let pid: any = null;
  const set = (px: number, py: number) => {
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = px - cx, dy = cy - py;              // dy: UP is positive (screen-y flipped here, once)
    const d = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(d, R);
    const nx = dx / d, ny = dy / d;
    let mag = clamped / R; if (mag < deadZone) mag = 0;
    state.x = nx * mag; state.y = ny * mag; state.mag = mag; state.angle = Math.atan2(ny, nx);
    knob.style.transform = `translate(${nx * clamped}px, ${-ny * clamped}px)`;
  };
  const reset = () => { state.x = state.y = state.mag = 0; state.active = false; knob.style.transform = 'translate(0,0)'; knob.style.opacity = '0.55'; };
  base.addEventListener('pointerdown', (e: any) => { pid = e.pointerId; state.active = true; knob.style.opacity = '1'; try { base.setPointerCapture(pid); } catch {} set(e.clientX, e.clientY); e.preventDefault(); });
  base.addEventListener('pointermove', (e: any) => { if (e.pointerId !== pid) return; set(e.clientX, e.clientY); e.preventDefault(); });
  const up = (e: any) => { if (e.pointerId !== pid) return; pid = null; reset(); };
  base.addEventListener('pointerup', up); base.addEventListener('pointercancel', up);
  return state; // read state.x (right+), state.y (UP+), state.mag (0..1)
}

export function createButton(label: string, opts: any = {}) {
  const { side = 'right', bottom = 40, offset = 0, color = '#ffffff', wide = false, onTap = null } = opts;
  let held = false, edge = false;
  const el = document.createElement('button');
  el.textContent = label;
  const base: any = { position: 'fixed', bottom: (bottom + offset) + 'px', border: '2px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.12)', color, fontWeight: '700', fontSize: '15px', touchAction: 'none', zIndex: '55', userSelect: 'none', cursor: 'pointer' };
  if (wide) Object.assign(base, { left: '50%', transform: 'translateX(-50%)', width: '200px', height: '54px', borderRadius: '14px' });
  else Object.assign(base, { [side]: '32px', width: '68px', height: '68px', borderRadius: '50%' });
  Object.assign(el.style, base); document.body.appendChild(el);
  el.dataset.gtButton = String(label || '');
  if (/again|restart|retry|replay/i.test(String(label || ''))) el.dataset.gtRestart = '1'; // sandbox marker
  const down = (e: any) => { if (!held) edge = true; held = true; el.style.background = 'rgba(255,255,255,0.3)'; if (onTap) onTap(); e.preventDefault(); };
  const up = (e: any) => { held = false; el.style.background = 'rgba(255,255,255,0.12)'; e && e.preventDefault && e.preventDefault(); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  return {
    get pressed() { return held; },
    justPressed() { const j = edge; edge = false; return j; }, // true once per press
    remove() { el.remove(); },
    el,
  };
}
