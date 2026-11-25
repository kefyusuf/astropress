import { Agent } from '../domain/agent';
import { AgentRequest } from '../interface/agent-request';

export const IDENTITY_RESOLVER = Symbol('IDENTITY_RESOLVER');

// Kimlik çözümleme seam (Faz-2+): header-claim (default parity) | token (bearer).
// resolve req.agent'ı üretir; kimlik yoksa UnauthorizedException fırlatır.
export interface IdentityResolver {
  resolve(req: AgentRequest): Agent;
}