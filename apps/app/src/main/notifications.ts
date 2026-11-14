import { Notification, type BrowserWindow } from 'electron';
import type { ClientCore } from '../client-core/runtime.js';
import { announcer } from '../client-core/announcements.js';
import { OPEN_CHANNEL, type OpenTarget } from '../shared/contracts.js';

// OS notifications, when the owner turned them on: a new attention item while the window is not
// in front. Clicking one brings the window forward and opens the run it is about. A notification
// is only a link: what it announces stays in the attention list whether or not it was shown.
export function watchAttention(window: BrowserWindow, core: ClientCore): () => void {
  const announce = announcer();
  const look = () => {
    const fresh = announce(core.sync.projectionProfile, core.sync.projection);
    if (!core.preferences.value.notifications || window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;
    for (const { body, runId, nodeId } of fresh) {
      const notification = new Notification({ title: 'Shift needs you', body });
      notification.on('click', () => {
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        const target: OpenTarget = { runId, nodeId };
        window.webContents.send(OPEN_CHANNEL, target);
      });
      notification.show();
    }
  };
  look();
  return core.sync.subscribe(look);
}
