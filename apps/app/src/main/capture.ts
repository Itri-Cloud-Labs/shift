import { nativeTheme, type BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientCore } from '../client-core/runtime.js';

// Development screenshots for design review, driven by tools/capture.mjs. Only unpackaged
// builds reach this. Each step can pair with a server, switch theme, change the route, run a
// small script in the page, resize the window, and then captures a PNG.

interface Step {
  name: string;
  pair?: { url: string; phrase: string };
  theme?: 'dark' | 'light';
  hash?: string;
  script?: string;
  size?: [number, number];
  // Drags a node by a distance with real mouse input.
  drag?: { node: string; by: [number, number] };
  // Drags from one element to another with real mouse input, by CSS selector.
  pull?: { from: string; to: string | [number, number] };
  // Real key presses, for what must work without a mouse.
  keys?: string[];
  // Asks the window to close; a guard may hold it open.
  close?: boolean;
  wait?: number;
  // After waiting: an expression that must hold, and one whose value is printed.
  expect?: string;
  report?: string;
}

export async function runCapture(window: BrowserWindow, core: ClientCore): Promise<void> {
  const directory = process.env['SHIFT_CAPTURE_DIR'];
  const steps = JSON.parse(process.env['SHIFT_CAPTURE_STEPS'] ?? '[]') as Step[];
  if (!directory) throw new Error('SHIFT_CAPTURE_DIR is required');
  await mkdir(directory, { recursive: true });
  const contents = window.webContents;
  for (const step of steps) {
    if (step.theme) nativeTheme.themeSource = step.theme;
    if (step.size) window.setSize(step.size[0], step.size[1]);
    if (step.pair) {
      await core.connection.pair({ ...step.pair, deviceName: 'Capture' });
      for (let index = 0; index < 200 && core.sync.state.status !== 'live'; index++)
        await delay(100);
      if (core.sync.state.status !== 'live') throw new Error('Capture could not go live');
    }
    if (step.hash !== undefined)
      await contents.executeJavaScript(`location.hash = ${JSON.stringify(step.hash)}`);
    // A script may return a promise, which the step waits for.
    if (step.script) await contents.executeJavaScript(step.script);
    if (step.drag) {
      const box = (await contents.executeJavaScript(
        `(() => { const r = document.querySelector('.react-flow__node[data-id=${JSON.stringify(step.drag.node)}] .node-header').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`,
      )) as [number, number];
      const [x, y] = box.map(Math.round) as [number, number];
      contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      for (let index = 1; index <= 10; index++) {
        contents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(x + (step.drag.by[0] * index) / 10),
          y: Math.round(y + (step.drag.by[1] * index) / 10),
          button: 'left',
        });
        await delay(30);
      }
      contents.sendInputEvent({
        type: 'mouseUp',
        x: x + step.drag.by[0],
        y: y + step.drag.by[1],
        button: 'left',
        clickCount: 1,
      });
    }
    if (step.pull) {
      const centre = async (selector: string) => {
        const point = (await contents.executeJavaScript(
          `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`,
        )) as [number, number];
        return point;
      };
      const [x, y] = await centre(step.pull.from);
      const [toX, toY] =
        typeof step.pull.to === 'string' ? await centre(step.pull.to) : step.pull.to;
      contents.sendInputEvent({ type: 'mouseMove', x, y });
      contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      for (let index = 1; index <= 10; index++) {
        contents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(x + ((toX - x) * index) / 10),
          y: Math.round(y + ((toY - y) * index) / 10),
          button: 'left',
        });
        await delay(30);
      }
      contents.sendInputEvent({ type: 'mouseUp', x: toX, y: toY, button: 'left', clickCount: 1 });
    }
    if (step.keys) contents.focus();
    for (const keyCode of step.keys ?? []) {
      contents.sendInputEvent({ type: 'keyDown', keyCode });
      if (keyCode.length === 1 || keyCode === 'Return')
        contents.sendInputEvent({ type: 'char', keyCode });
      contents.sendInputEvent({ type: 'keyUp', keyCode });
      await delay(60);
    }
    if (step.close) window.close();
    await delay(step.wait ?? 1200);
    if (step.expect && !(await contents.executeJavaScript(step.expect)))
      throw new Error(`Capture step ${step.name}: ${step.expect} does not hold`);
    if (step.report)
      console.log(
        `SHIFT_REPORT ${step.name} ${JSON.stringify(await contents.executeJavaScript(step.report))}`,
      );
    const image = await contents.capturePage();
    await writeFile(join(directory, `${step.name}.png`), image.toPNG());
    console.log(`SHIFT_CAPTURE ${step.name}`);
  }
}
