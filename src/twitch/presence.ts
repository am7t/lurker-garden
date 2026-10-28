import type { Viewer } from '../garden/plant.js';
import type { Garden } from '../garden/service.js';
import { growthRules } from '../garden/growth.config.js';

export interface ChatterPage { viewers: Viewer[]; cursor?: string }

export async function collectChatters(
  page: (after?: string) => Promise<ChatterPage>,
  active: () => boolean = () => true,
): Promise<Viewer[] | undefined> {
  const viewers = new Map<string, Viewer>();
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    if (!active()) return undefined;
    const result = await page(after);
    if (!active()) return undefined;
    for (const viewer of result.viewers) viewers.set(viewer.userId, viewer);
    after = result.cursor || undefined;
    if (after && cursors.has(after)) throw new Error('Twitch repeated a chatter pagination cursor.');
    if (after) cursors.add(after);
  } while (after);
  return [...viewers.values()];
}

interface PresenceDependencies {
  garden: Pick<Garden, 'tick' | 'maintain'>;
  getLive(): Promise<boolean>;
  getPage(after?: string): Promise<ChatterPage>;
  forceLive: boolean;
  speed: number;
  warn(message: string): void;
  now?: () => number;
}

export function createPresence({ garden, getLive, getPage, forceLive, speed, warn, now = Date.now }: PresenceDependencies) {
  let running = false;
  let actualLive = false;
  let liveSince = 0;
  let revision = 0;
  let generation = 0;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const live = () => running && (forceLive || actualLive);

  function setLive(value: boolean) {
    const wasLive = live();
    actualLive = value;
    revision++;
    if (live() && !wasLive) liveSince = now();
  }
  function stop() {
    running = false;
    actualLive = false;
    revision++;
    generation++;
    if (timer) clearTimeout(timer);
    timer = undefined;
  }
  function schedule(epoch: number) {
    if (!running || epoch !== generation) return;
    timer = setTimeout(() => { void poll(epoch); }, growthRules.tickMs);
    timer.unref();
  }
  async function poll(epoch: number) {
    try {
      if (epoch !== generation || !running) return;
      garden.maintain();
      if (busy || !live() || now() - liveSince < growthRules.tickMs) return;
      busy = true;
      const version = revision;
      try {
        const active = () => epoch === generation && running && live() && version === revision;
        const viewers = await collectChatters(getPage, active);
        if (viewers && active()) garden.tick(viewers, true, speed);
      } finally { busy = false; }
    } catch {
      warn('Presence poll failed; this tick was skipped. Retrying in one minute.');
    } finally { schedule(epoch); }
  }
  return {
    get live() { return live(); },
    get actualLive() { return actualLive; },
    setLive,
    stop,
    async start() {
      stop();
      running = true;
      liveSince = now();
      const epoch = generation;
      const version = revision;
      try {
        const status = await getLive();
        // A stream event arriving during the REST check is newer than its result.
        if (epoch === generation && revision === version) setLive(status);
      } catch { warn('Could not check stream status; growth waits for a stream event or reconnect.'); }
      finally { schedule(epoch); }
    },
  };
}
