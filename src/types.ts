export interface TuningTableData {
  rows: number[]; // RPM
  cols: number[]; // Load
  data: number[][]; // Grid values
}

export interface Telemetry {
  rpm: number;
  tps: number;
  afr: number;
  load: number;
  knockCount: number;
  timing: number;
  revLimit: number;
  engineStressed: boolean;
  engineTemp: number;
  mode: 'IDLE' | 'RUNNING';
}

export type EngineStatus = 'OFF' | 'ON' | 'DEAD';
