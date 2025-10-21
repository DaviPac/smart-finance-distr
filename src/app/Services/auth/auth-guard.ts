import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';
import { UsersService } from '../user/user';

export const authGuard: CanActivateFn = async (_route, _state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const usersService = inject(UsersService)

  if (authService.isAuthenticated()) {
    const authenticatedUser = authService.currentFirebaseUser();
    if (!authenticatedUser) {
      router.navigate(['/login']);
      return false;
    }
    const userData = await usersService.getUserById(authenticatedUser.uid)
    if (!userData) {
      router.navigate(['/login']);
      return false;
    }
    authService.currentUser.set(userData);
    return true;
  }

  router.navigate(['/login']);
  return false;
};