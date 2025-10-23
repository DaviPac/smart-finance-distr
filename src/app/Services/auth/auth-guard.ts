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
    const userDataStr = localStorage.getItem('userData');
    if (!userDataStr) {
      return router.parseUrl('/login');
    }
    const userData = JSON.parse(userDataStr);
    if (!userData || !userData.uid || userData.uid !== authenticatedUser.uid) {
      return router.parseUrl('/login');
    }
    authService.currentUser.set(userData);
    authService.updateCurrentUser(authenticatedUser.uid);
    return true;
  }

  router.navigate(['/login']);
  return false;
};