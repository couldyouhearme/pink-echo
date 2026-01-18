
export interface AudioConfig {
  sampleRate: number;
  channels: number;
}

export enum ConnectionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface TranscriptionItem {
  text: string;
  type: 'user' | 'model';
  timestamp: number;
}
