export const errorStatuses = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  ORIGIN_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CLIENT_NAME_TAKEN: 409,
  CLIENT_INACTIVE: 409,
  EMAIL_ALREADY_REGISTERED: 409,
  INVALID_STATUS_TRANSITION: 409,
  PROJECT_NOT_ACTIVE: 409,
  PROJECT_ARCHIVED: 409,
  PROJECT_HAS_NO_STAGES: 409,
  PROJECT_REQUIRES_STAGE: 409,
  STAGE_NOT_CURRENT: 409,
  STAGE_ALREADY_COMPLETED: 409,
  NOT_LAST_COMPLETED_STAGE: 409,
  STAGE_LOCKED: 409,
  STAGE_LIMIT_REACHED: 409,
  TEMPLATE_NAME_TAKEN: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type ErrorCode = keyof typeof errorStatuses;
export class DomainError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}

export class RateLimitError extends DomainError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED');
  }
}
