import { Agent } from '../domain/agent';

export const AGENT_REGISTRY = Symbol('AGENT_REGISTRY');

// Registry port (Faz-4): file (boot-load config) | postgres (per-request query, multi-instance).
export interface AgentRegistry {
  getAgent(id: string): Promise<Agent>;
  listAgents(): Promise<Agent[]>;
}