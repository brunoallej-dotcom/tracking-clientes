import 'server-only';
import { z } from 'zod';
const appSchema = z.object({
  APP_URL: z.url().refine((url) => {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname))
    );
  }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
const supabaseSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});
const secretSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  RATE_LIMIT_PEPPER: z.string().min(32),
});
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('Invalid server configuration');
  return result.data;
}
export const getAppEnv = () => parse(appSchema, process.env);
export const getSupabaseEnv = () => parse(supabaseSchema, process.env);
export const getSecretEnv = () => parse(secretSchema, process.env);
