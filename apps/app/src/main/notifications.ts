import { Notification, type BrowserWindow } from 'electron';
import type { ClientCore } from '../client-core/runtime.js';
import { announcer } from '../client-core/announcements.js';

// OS notifications, when the owner turned them on: a new attention item while the window is not
// in front. Clicking one brings the window forward, where the attention count shows it.
export function watchAttention(window: BrowserWindow, core: ClientCore): () => void {
  const announce = announcer();
  const look = () => {
    const fresh = announce(core.sync.projectionProfile, core.sync.projection);
    if (!core.preferences.value.notifications || window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;
    for (const { body } of fresh) {
      const notification = new Notification({ title: 'Shift needs you', body });
      notification.on('click', () => {
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      });
      notification.show();
    }
  };
  look();
  return core.sync.subscribe(look);
}
