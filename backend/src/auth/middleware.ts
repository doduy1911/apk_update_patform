import { timingSafeEqual, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.session.adminId) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Đăng nhập quản trị để tiếp tục.' } });
    return;
  }
  next();
}

export function requireSameOrigin(expectedOrigin: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.get('origin') !== expectedOrigin) {
      response.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Nguồn yêu cầu không hợp lệ.' } });
      return;
    }
    next();
  };
}

export function requireCsrf(request: Request, response: Response, next: NextFunction) {
  const expected = request.session.csrfToken;
  const supplied = request.get('x-csrf-token');
  if (!expected || !supplied) {
    response.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Yêu cầu thiếu mã bảo vệ phiên.' } });
    return;
  }
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    response.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Mã bảo vệ phiên không hợp lệ.' } });
    return;
  }
  next();
}

export function newCsrfToken() {
  return randomBytes(32).toString('base64url');
}
