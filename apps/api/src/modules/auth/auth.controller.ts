import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import * as authService from './auth.service';

// Controllers are deliberately thin: read the (already validated) request, call the service,
// shape the HTTP response. Business logic lives in the service.

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function demoLogin(_req: Request, res: Response) {
  const result = await authService.demoLogin();
  res.json(result);
}

export async function me(req: Request, res: Response) {
  const { userId } = requireAuth(req);
  res.json(await authService.getProfile(userId));
}
