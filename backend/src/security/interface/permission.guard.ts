import 'reflect-metadata';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, RequestMethod } from '@nestjs/common';
import { Agent } from '../domain/agent';
import { AgentRequest } from './agent-request';
import { POLICY, routeKey } from './policy';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AgentRequest>();
    const agent = req.agent as Agent; // IdentityMiddleware garantiler (ya bağlar ya 401)
    const handler = context.getHandler();
    const cls = context.getClass();
    const method = RequestMethod[Reflect.getMetadata('method', handler) as number];
    const ctrlPath = (Reflect.getMetadata('path', cls) as string) ?? '';
    const handlerPath = (Reflect.getMetadata('path', handler) as string) ?? '';
    const key = routeKey(method, ctrlPath, handlerPath);
    const perm = POLICY[key];

    if (perm === 'public') return true;
    if (!perm) {
      this.logger.warn(`Unmapped route denied (fail-closed): ${key} agent=${agent.id}`);
      throw new ForbiddenException(`Yetki yok: ${key}`);
    }
    if (!agent.perms[perm]) {
      this.logger.warn(`RBAC denied: agent=${agent.id} perm=${perm} route=${key}`);
      throw new ForbiddenException(`Yetki yok: ${perm}`);
    }
    return true;
  }
}