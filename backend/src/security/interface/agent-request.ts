import { Agent } from '../domain/agent';

// Express types (@types/express) kurulu değil → perimeter'in lokal request contract'ı.
// IdentityMiddleware req.agent'ı bağlar; guard'lar getRequest<AgentRequest>() ile okur.
export interface AgentRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  agent?: Agent;
  ip?: string;
}