import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';

  showPassword = false;
  showConfirm = false;

  loading = false;
  msg = '';

  constructor(private router: Router) {}

  async submit(): Promise<void> {
    this.msg = '';

    // Validaciones (SIN retornar expresiones)
    if (!this.name.trim()) {
      this.msg = 'Ingresa tu nombre.';
      return;
    }

    if (!this.email.trim()) {
      this.msg = 'Ingresa tu email.';
      return;
    }

    if (!this.password) {
      this.msg = 'Ingresa una contraseña.';
      return;
    }

    if (this.password.length < 8) {
      this.msg = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.msg = 'Las contraseñas no coinciden.';
      return;
    }

    this.loading = true;

    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.email,
          password: this.password,
          displayName: this.name,
        }),
      });

      const data: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        this.msg = data?.message || `Error ${res.status}`;
        return;
      }

      this.msg = '✅ Cuenta creada. Ahora inicia sesión.';
      setTimeout(() => this.router.navigate(['/login']), 600);
    } catch (e: any) {
      this.msg = e?.message || 'Error conectando con el servidor.';
    } finally {
      this.loading = false;
    }
  }
}
