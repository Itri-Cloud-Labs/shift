import type { BrowserWindow } from 'electron';

// The packaged app against a real server, driven through the renderer's own bridge as a person
// would use it (tools/live-smoke.mjs). Two launches share one profile: `pair` pairs, checks that the
// device key is kept by the operating system and starts a run; `resume` starts without pairing,
// reconnects and finds the run finished while the app was closed. Only with --shift-smoke.
export interface LiveSmoke {
  phase: 'pair' | 'resume';
  url: string;
  phrase?: string;
  workflowId?: string;
  runId?: string;
  // Whether the device key must survive restarts (an OS keychain or secret service is present).
  persistent: boolean;
}

export function liveSmokeFromEnvironment(): LiveSmoke | null {
  const raw = process.env['SHIFT_SMOKE_LIVE'];
  if (!raw) return null;
  return JSON.parse(raw) as LiveSmoke;
}

export async function runLiveSmoke(window: BrowserWindow, plan: LiveSmoke): Promise<void> {
  const report: unknown = await window.webContents.executeJavaScript(`(async () => {
    const plan = ${JSON.stringify(plan)};
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const until = async (read, what, seconds = 60) => {
      for (let i = 0; i < seconds * 4; i++) {
        const value = await read();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Timed out waiting for ' + what);
    };
    const live = () => window.shift.sync.read().then(answer => answer.kind === 'sync' && answer.sync.status === 'live');
    if (plan.phase === 'pair') {
      const paired = await window.shift.connection.pair({ url: plan.url, phrase: plan.phrase, deviceName: 'Packaged smoke' });
      assert(paired.kind === 'connection' && !paired.connection.problem, 'Pairing failed: ' + JSON.stringify(paired));
      assert(paired.connection.credentialStorage === (plan.persistent ? 'persistent' : 'session'), 'Device key storage is ' + paired.connection.credentialStorage);
      assert(!/token|bearer|credentialHandle/i.test(JSON.stringify(paired)), 'Credential reached the renderer');
      await until(live, 'a live connection');
      const started = await window.shift.run.start(plan.workflowId, {});
      assert(started.kind === 'command' && started.runId, 'Run start failed: ' + JSON.stringify(started));
      return { phase: 'pair', runId: started.runId, credentialStorage: paired.connection.credentialStorage };
    }
    // Resume: the saved profile reconnects with the stored device key, no pairing form.
    await until(live, 'reconnection with the stored device key');
    assert(!document.querySelector('.pairing'), 'Asked to pair again');
    const finished = await until(async () => {
      const answer = await window.shift.data.run(plan.runId);
      const state = answer.kind === 'resource' ? answer.value.run.state : null;
      return state && !['RUNNING', 'WAITING'].includes(state) ? state : null;
    }, 'the run to finish');
    assert(finished === 'COMPLETED', 'The run is ' + finished);
    return { phase: 'resume', runState: finished };
  })()`);
  console.log(`SHIFT_LIVE ${JSON.stringify(report)}`);
}
