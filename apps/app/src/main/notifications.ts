import { Notification, type BrowserWindow } from 'electron';
import type { ClientCore } from '../client-core/runtime.js';
import { announcements } from '../client-core/announcements.js';

// OS notifications, when the owner turned them on: a new attention item while the window is not
// in front. Clicking one brings the window forward, where the attention count shows it.
export function watchAttention(window: BrowserWindow, core: ClientCore): () => void {
  let known: Set<string> | null = null;
  let profile: string | null = null;
  const look = () => {
    const projection = core.sync.projection;
    // Another server's first look is a first look too: what is open there is not new.
    const profileId = core.connection.state.profileId;
    if (!projection || profileId !== profile) known = null;
    profile = profileId;
    if (!projection) return;
    const result = announcements(known, projection.interactions, projection.runs);
    known = result.known;
    if (!core.preferences.value.notifications || window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;
    for (const { body } of result.fresh) {
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
