import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth'; // Ajuste o caminho

export const loginGuard: CanActivateFn = (_route, _state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Se o usuário JÁ ESTIVER logado...
  if (authService.isAuthenticated() && authService.isLoggedIn()) {
    router.navigate(['/groups']);
    return false;
  }

  return true;
};