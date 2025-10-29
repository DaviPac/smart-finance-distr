import { Component, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../Services/auth/auth';

@Component({
  selector: 'app-navbar',
  imports: [
    RouterModule
  ],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss'
})
export class Navbar {
  private router = inject(Router);
  private authService = inject(AuthService);

  isMobileMenuOpen = signal<boolean>(false);

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(value => !value);
  }
  
  async navigate(route: string) {
    await this.router.navigate([route]);
    this.isMobileMenuOpen.set(false);
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  nome(): string | undefined {
    return this.authService.currentUser()?.name;
  }

  email(): string | undefined {
    return this.authService.currentUser()?.email;
  }

  isAuthenticated() {
    return this.authService.currentUser()
  }

}
