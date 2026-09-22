import type { AuthContext } from '../shared/security/jwt';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. Undefined on public routes. */
      auth?: AuthContext;
    }
  }
}

export {};
