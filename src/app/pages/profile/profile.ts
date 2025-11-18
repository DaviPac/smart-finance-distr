import { Component, inject, Injector, signal } from '@angular/core';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile',
  imports: [],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  standalone: true
})
export class Profile {
  private authService = inject(AuthService)
  private usersService = inject(UsersService)
  private router = inject(Router)
  injector = inject(Injector)

  user = this.authService.currentUser
  isLoading = signal(false)
  successMessage = signal<string | null>(null)
  errorMessage = signal<string | null>(null)

  logout() {
    this.authService.logout()
  }

  async changeUsername(newName: string) {
    this.successMessage.set(null)
    this.errorMessage.set(null)
    this.isLoading.set(true)
    try {
      await this.usersService.changeUsername(newName)
      this.successMessage.set("Nome de usuário modificado com sucesso!")
    } catch (e) {
      const error = e as Error
      this.errorMessage.set(error.message)
    }
    this.isLoading.set(false)
  }
}
