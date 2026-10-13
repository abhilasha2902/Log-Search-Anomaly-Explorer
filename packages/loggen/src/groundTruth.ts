import type { IncidentCause } from "./incidents.js";
import type { Service } from "./templates.js";

export interface GroundTruthTemplate {
  id: string;
  pattern: string;
}

export interface GroundTruthEvent {
  line: number;
  templateId: string;
}

export interface GroundTruthIncident {
  cause: IncidentCause;
  service: Service;
  startTs: string;
  endTs: string;
}

export interface GroundTruth {
  templates: GroundTruthTemplate[];
  events: GroundTruthEvent[];
  incidents: GroundTruthIncident[];
}
