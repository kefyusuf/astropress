import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Global catch-all: domain/https filtreleri (Domain/BuildExceptionFilter) önce eşleşir;
 * buraya düşen her şey tanımlı bir JSON hataya dönüştürülür (Nest'in default HTML/boş
 * 500'ü yerine RFC-benzeri gövde; issue #10). UnknownError → 500 + generic mesaj
 * (iç hata detayı sızdırılmaz), HttpException'lar kendi statüleriyle geçer.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Nesne gövde (örn. readyz 503 readiness snapshot, ValidationPipe 400) BÜTÜN olarak
      // korunur — Nest default davranışıyla aynı sözleşme; yalnız string mesaj zarfa girer.
      if (typeof body === 'object' && body !== null) {
        res.status(status).json(body);
        return;
      }
      res.status(status).json({ statusCode: status, message: body, path: req?.url });
      return;
    }

    // body-parser hataları (PayloadTooLargeError vb.) HttpException değil ama status taşır —
    // 413/400 gibi anlamlı statüler korunur (issue #10).
    const carried = exception as { status?: unknown; statusCode?: unknown };
    const carriedStatus = Number(carried?.status ?? carried?.statusCode);
    if (Number.isInteger(carriedStatus) && carriedStatus >= 400 && carriedStatus <= 599) {
      res.status(carriedStatus).json({ statusCode: carriedStatus, message: 'İstek gövdesi geçersiz', path: req?.url });
      return;
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'İç sunucu hatası',
      path: req?.url,
    });
  }
}
