import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';
import { UsersService } from '../user/user';
import { firstValueFrom } from 'rxjs';

export const authGuard: CanActivateFn = async (_route, _state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const usersService = inject(UsersService);

  const authenticatedUser = await firstValueFrom(authService.user$);

  if (authenticatedUser) {
    const userData = await usersService.getUserById(authenticatedUser.uid)
    if (!userData) {
      return router.parseUrl('/login');
    }
    authService.currentUser.set(userData);
    return true;
  }

  router.navigate(['/login']);
  return false;
};