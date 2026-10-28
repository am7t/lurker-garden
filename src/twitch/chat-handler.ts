import { isLurkCommand, plantingReply } from '../garden/plant.js';
import type { Garden } from '../garden/service.js';

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
}

export function createChatHandler(garden: Garden, reply: (text: string, messageId: string) => Promise<void>) {
  // EventSub can deliver a message more than once. Bound memory use in busy chats.
  const seen = new Map<string, number>();
  return async (message: ChatMessage): Promise<void> => {
    const now = Date.now();
    for (const [id, receivedAt] of seen) {
      if (now - receivedAt < 10 * 60_000) break;
      seen.delete(id);
    }
    if (seen.has(message.id)) return;
    seen.set(message.id, now);
    if (seen.size > 10_000) seen.delete(seen.keys().next().value!);

    const viewer = { userId: message.userId, displayName: message.displayName };
    if (!isLurkCommand(message.text)) {
      garden.seen(viewer);
      return;
    }
    const result = garden.plant(viewer);
    // Commit the seed before replying: a chat API failure must never lose a plant.
    await reply(plantingReply(result), message.id);
  };
}
