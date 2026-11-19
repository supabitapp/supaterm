import { uuidv4 } from "./uuid";

export interface TurnCommandMetadata {
  readonly commandId: string;
  readonly messageId: string;
  readonly threadId: string;
  readonly createdAt: string;
}

export function makeTurnCommandMetadata() {
  return {
    commandId: uuidv4(),
    messageId: uuidv4(),
    threadId: uuidv4(),
    createdAt: new Date().toISOString(),
  };
}

export function makeQueuedMessageMetadata() {
  return {
    commandId: uuidv4(),
    messageId: uuidv4(),
    createdAt: new Date().toISOString(),
  };
}
