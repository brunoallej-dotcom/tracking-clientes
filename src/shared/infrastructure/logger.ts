import 'server-only';
import pino from 'pino';
import { getAppEnv } from './env';
export function createLogger(destination?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    level: getAppEnv().LOG_LEVEL,
    base: undefined,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'headers.cookie',
        'headers.authorization',
        'password',
        'currentPassword',
        'newPassword',
        'temporaryPassword',
        'email',
        'token',
        'name',
        'fullName',
        'ip',
        'cookie',
        'authorization',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.temporaryPassword',
        '*.email',
        '*.token',
        '*.name',
        '*.fullName',
        '*.ip',
        '*.cookie',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
