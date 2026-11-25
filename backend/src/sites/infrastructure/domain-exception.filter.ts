import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { SiteValidationError, SiteNotFoundError, SiteAlreadyExistsError } from '../domain/errors';

// Domain hatalarını HTTP durum kodlarına çevirir (infrastructure/HTTP concern).
// APP_FILTER ile global kayıtlı → hem main.ts hem test bootstrap'ında geçerli.
@Catch(SiteValidationError, SiteNotFoundError, SiteAlreadyExistsError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: SiteValidationError | SiteNotFoundError | SiteAlreadyExistsError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const status =
      exception instanceof SiteNotFoundError ? HttpStatus.NOT_FOUND
      : exception instanceof SiteAlreadyExistsError ? HttpStatus.CONFLICT
      : HttpStatus.BAD_REQUEST;
    res.status(status).json({ statusCode: status, error: exception.name, message: exception.message });
  }
}