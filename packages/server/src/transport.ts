export interface TextClient {
  sendText(message: string): void;
}

export interface BinaryClient {
  sendBinary(message: Uint8Array): void;
}

export interface ControlClient extends TextClient {}

export interface PtyClient extends BinaryClient {}
