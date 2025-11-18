import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

export const authGuard: CanActivateFn = async (_route, _state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const user = authService.currentUser()

  if (user) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};