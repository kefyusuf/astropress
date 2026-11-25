import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { BuildJobNotFoundError, BuildQueueFullError, BuildValidationError } from '../domain/errors';

// Domain hatalarını HTTP kodlarına çevirir (sites DomainExceptionFilter parity).
@Catch(BuildJobNotFoundError, BuildValidationError, BuildQueueFullError)
export class BuildExceptionFilter implements ExceptionFilter {
  catch(exception: BuildJobNotFoundError | BuildValidationError | BuildQueueFullError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const status = exception instanceof BuildJobNotFoundError ? HttpStatus.NOT_FOUND
      : exception instanceof BuildQueueFullError ? HttpStatus.TOO_MANY_REQUESTS
      : HttpStatus.BAD_REQUEST;
    res.status(status).json({ statusCode: status, error: exception.name, message: exception.message });
  }
}