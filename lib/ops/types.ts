/** Fleet health snapshot from ops_health_summary. */
export type OpsHealthSummary = {
  cost_paused: number;
  stuck_running_jobs: number;
  stuck_extracting_sessions: number;
  failed_jobs: number;
  pending_jobs: number;
  checked_at: string;
};

export type OpsFleetSession = {
  sessionId: string;
  status: string;
  mode: string;
  frameCount: number;
  createdAt: string;
  pauseReason: string | null;
  jobs: {
    pending: number;
    done: number;
    failed: number;
    overbudget: number;
  };
  tokens: {
    extractionInput: number;
    extractionOutput: number;
    synthesisInput: number;
    synthesisOutput: number;
    escalated: number;
    observations: number;
  };
};

export type OpsDailySpend = {
  day: string;
  extractionInput: number;
  extractionOutput: number;
  synthesisInput: number;
  synthesisOutput: number;
};

export type OpsModelQualityRow = {
  observationId: string;
  sessionId: string;
  segmentId: string;
  humanCorrected: boolean;
  overrides: Record<string, unknown>;
  model: string;
  createdAt: string;
};

export type OpsExtractionModelStat = {
  model: string;
  total: number;
  escalated: number;
  inputTokens: number;
  outputTokens: number;
};
