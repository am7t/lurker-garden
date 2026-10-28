import { EventEmitter } from 'node:events';
import type { Plant } from './plant.js';

export interface GardenEvent {
  type: 'planted' | 'stage_up' | 'watered' | 'woke';
  at: string;
  plant: Plant;
}

// In-process events only: subscribe again and fetch the garden after a restart.
export function createGardenEvents() {
  const emitter = new EventEmitter();
  return {
    publish(event: GardenEvent) { emitter.emit('garden', event); },
    subscribe(listener: (event: GardenEvent) => void) {
      emitter.on('garden', listener);
      return () => { emitter.off('garden', listener); };
    },
  };
}
