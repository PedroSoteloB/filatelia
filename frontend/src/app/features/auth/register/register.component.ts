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

  async submit() {
    this.msg = '';

    // Validaciones
    if (!this.name.trim()) return (this.msg = 'Ingresa tu nombre.');
    if (!this.email.trim()) return (this.msg = 'Ingresa tu email.');
    if (!this.password) return (this.msg = 'Ingresa una contraseña.');
    if (this.password.length < 8)
      return (this.msg = 'La contraseña debe tener al menos 8 caracteres.');
    if (this.password !== this.confirmPassword)
      return (this.msg = 'Las contraseñas no coinciden.');

    this.loading = true;

    try {
      // 🔥 LLAMADA REAL AL BACKEND
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.email,
          password: this.password,
          displayName: this.name, // 👈 IMPORTANTE
        }),
      });

      const data = await res.json().catch(() => ({}));

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
