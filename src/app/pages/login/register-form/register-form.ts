import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-register-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './register-form.html',
})
export class RegisterFormComponent {
  @Input() isLoading = false;
  @Output() registerSubmit = new EventEmitter<any>();

  private fb = inject(NonNullableFormBuilder);

  registerForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  onSubmit(): void {
    if (this.registerForm.valid) {
      this.registerSubmit.emit(this.registerForm.getRawValue());
    }
  }
}