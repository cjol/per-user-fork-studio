export interface LogEntry {
  oid: string;
  short: string;
  message: string;
}

export interface AppState {
  user: string;
  repo: string;
  loggedIn: boolean;
  pushedToFork: boolean;
  log: LogEntry[];
  baseAhead: boolean;
  error?: string;
  note?: string;
}
