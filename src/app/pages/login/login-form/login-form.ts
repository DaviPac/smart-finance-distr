import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login-form.html',
})
export class LoginFormComponent {
  @Input() isLoading = false;
  @Output() loginSubmit = new EventEmitter<any>();

  private fb = inject(NonNullableFormBuilder);

  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  onSubmit(): void {
    if (this.loginForm.valid) {
      this.loginSubmit.emit(this.loginForm.getRawValue());
    }
  }
}