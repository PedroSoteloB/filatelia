import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-register',
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
      // ✅ Aquí luego conectas al backend:
      // await this.authService.register({ name: this.name, email: this.email, password: this.password });

      // Simulación de éxito (para que la vista funcione ya)
      await new Promise((r) => setTimeout(r, 700));

      this.msg = '✅ Cuenta creada. Ahora inicia sesión.';
      setTimeout(() => this.router.navigate(['/login']), 600);
    } catch (e: any) {
      this.msg = e?.message || 'Ocurrió un error creando la cuenta.';
    } finally {
      this.loading = false;
    }
  }
}
