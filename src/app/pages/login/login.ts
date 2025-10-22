import { Component, effect, inject, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../Services/auth/auth';
import { LoginFormComponent } from './login-form/login-form';
import { RegisterFormComponent } from './register-form/register-form';

/**
 * Componente responsável pela autenticação do usuário,
 * permitindo tanto o login quanto o registro.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoginFormComponent, RegisterFormComponent],
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class Login {

  private router = inject(Router);
  private authService = inject(AuthService);

  mode = signal<'login' | 'register'>('login');
  submitted = signal(false);
  authFailed = signal(false);
  isLoading = signal(false);

  setMode(newMode: 'login' | 'register'): void {
    this.mode.set(newMode);
    this.submitted.set(false);
    this.authFailed.set(false);
  }

  async onSubmit(formData: any): Promise<void> {
    this.submitted.set(true);
    this.authFailed.set(false);
    this.isLoading.set(true);

    try {
      const action = this.mode() === 'login'
        ? this.handleLogin(formData)
        : this.handleRegister(formData);
      
      const user = await action;

      if (user) {
        this.router.navigate(['/']);
      } else {
        this.authFailed.set(true);
      }
    } catch (error) {
      this.authFailed.set(true);
      console.error(`Falha na operação de ${this.mode()}:`, error);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  private handleLogin(data: any): Promise<any> {
    const { email, password } = data;
    return this.authService.login(email, password);
  }

  private handleRegister(data: any): Promise<any> {
    const { name, email, password } = data;
    return this.authService.register(email, password, name);
  }
}