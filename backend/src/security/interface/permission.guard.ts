import 'reflect-metadata';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Agent } from '../domain/agent';
import { AgentRequest } from './agent-request';
import { POLICY, routeKey } from './policy';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AgentRequest>();
    const handler = context.getHandler();
    const cls = context.getClass();
    // @nestjs/common sabitleri: private 'method'/'path' string'leri kırılgan (issue #10).
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
    const ctrlPath = (Reflect.getMetadata(PATH_METADATA, cls) as string) ?? '';
    const handlerPath = (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '';
    const key = routeKey(method, ctrlPath, handlerPath);
    const perm = POLICY[key];

    if (perm === 'public') return true;
    // Null-agent guard: IdentityMiddleware dışı rotalarda cast 500 yerine fail-closed 401 (issue #10).
    const agent = req.agent as Agent | undefined;
    if (!agent) {
      this.logger.warn(`Identity yok, route '${key}' denied (fail-closed)`);
      throw new UnauthorizedException('Kimlik doğrulanmadı');
    }
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