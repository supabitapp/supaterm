import { requireNativeModule, type NativeModule } from "expo";

export type RelayTunnelOptions = {
  relayUrl: string;
  hostAddress: string;
  directUrls?: string[];
  port?: number;
};

export type RelayTunnelStatus = {
  state: "connecting" | "up" | "down";
  hostAddress: string;
  origin: string;
  bytesSent: number;
  bytesReceived: number;
  activeStreams: number;
  sessionCount: number;
  via?: "relay" | "direct";
  reason?: string;
};

export type RelayTunnelEvents = {
  onStatus: (status: RelayTunnelStatus) => void;
};

export interface RelayTunnelModule extends NativeModule<RelayTunnelEvents> {
  addListener(event: "onStatus", listener: (status: RelayTunnelStatus) => void): { remove(): void };
  start(options: RelayTunnelOptions): Promise<{ origin: string }>;
  stop(hostAddress?: string): Promise<void>;
}

export default requireNativeModule<RelayTunnelModule>("SupatermRelayTunnel");
