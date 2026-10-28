import { isLurkCommand, plantingReply } from '../garden/plant.js';
import type { Garden } from '../garden/service.js';

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
}

export function createChatHandler(
  garden: Garden, reply: (text: string, messageId: string) => Promise<void>,
  isLive: () => boolean = () => false, speed = 1,
) {
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
    if (/^!water(?:\s|$)/i.test(message.text.trim())) {
      const result = garden.water(viewer, isLive(), speed);
      let text: string;
      if (result.status === 'missing') text = `@${viewer.displayName}, plant a seed with !lurk first, then we can water it!`;
      else if (result.status === 'offline') text = `@${viewer.displayName}, the garden is resting. Come water your plant when the stream is live!`;
      else if (result.status === 'cooldown') {
        const seconds = Math.ceil(result.waitMs / 1000);
        const wait = seconds >= 60 ? `${Math.ceil(seconds / 60)} minute(s)` : `${seconds} second(s)`;
        text = `@${viewer.displayName}, your plant is still sipping. Try watering again in ${wait}.`;
      } else text = `@${viewer.displayName}, a little drink for your plant! It's now at the ${result.plant.stage} stage.`;
      await reply(text, message.id);
      return;
    }
    if (!isLurkCommand(message.text)) {
      garden.seen(viewer);
      return;
    }
    const result = garden.plant(viewer);
    // Commit the seed before replying: a chat API failure must never lose a plant.
    await reply(plantingReply(result), message.id);
  };
}
