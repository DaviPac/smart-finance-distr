import { Injectable, Injector, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { User } from '../../models/user.model';
import runInContext from '../../decorators/run-in-context-decorator';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);

  token: string | null = null
  currentUser = signal<User | null>(null);
  
  injector = inject(Injector);

  isAuthenticated() {
    return !!this.currentUser();
  }

  isLoggedIn() {
    return !!this.currentUser();
  }

  @runInContext()
  async login(email: string, password: string): Promise<User | null> {
    try {
      const resp = await fetch("https://smart-finance-auth-production.up.railway.app/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      if (!resp.ok) throw new Error("email ou senha incorretos.")
      const data = await resp.json()
      this.token = data.token
      this.currentUser.set(data.user)
      localStorage.setItem('userData', JSON.stringify(this.currentUser()));
      console.log(this.currentUser())
      return this.currentUser();
    } catch (error) {
      console.error("Erro no login:", error);
      return null;
    }
  }

  // Registro de Novos Usuários
  async register(email: string, password: string, name: string): Promise<User | null> {
    try {
      const resp = await fetch("https://smart-finance-auth-production.up.railway.app/api/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      if (!resp.ok) throw new Error("erro ao se registrar")
      await this.login(email, password)
      this.router.navigate(['/'])

      return await resp.json();
    } catch (error) {
      console.error("Erro no registro:", error);
      return null;
    }
  }

  // Logout
  @runInContext()
  async logout(): Promise<void> {
    localStorage.removeItem('userData');
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }
}