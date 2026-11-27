import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { BuildJobNotFoundError, BuildQueueFullError, BuildValidationError, ConcurrencyError } from '../domain/errors';

// Domain hatalarını HTTP kodlarına çevirir (sites DomainExceptionFilter parity).
// ConcurrencyError → 409 Conflict (issue #12): event-store OCC reddi 500 değil.
@Catch(BuildJobNotFoundError, BuildValidationError, BuildQueueFullError, ConcurrencyError)
export class BuildExceptionFilter implements ExceptionFilter {
  catch(exception: BuildJobNotFoundError | BuildValidationError | BuildQueueFullError | ConcurrencyError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const status = exception instanceof BuildJobNotFoundError ? HttpStatus.NOT_FOUND
      : exception instanceof BuildQueueFullError ? HttpStatus.TOO_MANY_REQUESTS
      : exception instanceof ConcurrencyError ? HttpStatus.CONFLICT
      : HttpStatus.BAD_REQUEST;
    res.status(status).json({ statusCode: status, error: exception.name, message: exception.message });
  }
}
