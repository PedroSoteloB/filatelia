import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http'; // ⬅️ NUEVO

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HttpClientModule], // ⬅️ AGREGA HttpClientModule
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  email = 'user2@local.test';
  password = 'user2@local.test';
  loading = false;

  show = false;
  remember = true;
  msg = '';

  constructor(private router: Router, private http: HttpClient) {} // ⬅️ INYECTA HttpClient

  private decodeJwtPayload(token: string): any {
    try {
      const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
      return base64 ? JSON.parse(atob(base64)) : {};
    } catch { return {}; }
  }

  private isAdminFromPayload(p: any): boolean {
    const roles = p?.role ?? p?.roles ?? p?.permissions;
    if (roles === 'admin') return true;
    if (Array.isArray(roles) && roles.includes('admin')) return true;
    if ((p?.email ?? '').toLowerCase() === 'admin@local.test') return true;
    return false;
  }

  submit() {
    this.loading = true;
    this.msg = '';

    // ⬇️ Sustituye fetch por HttpClient (manteniendo la ruta relativa)
    this.http.post<any>('/auth/login', { email: this.email, password: this.password })
      .subscribe({
        next: (res) => {
          const storage = this.remember ? localStorage : sessionStorage;
          storage.setItem('accessToken', res.accessToken);
          storage.setItem('refreshToken', res.refreshToken);

          const p = this.decodeJwtPayload(res.accessToken);
          const displayName =
            p?.name ?? p?.given_name ?? p?.preferred_username ?? p?.email ?? this.email;
          storage.setItem('displayName', displayName);

          const isAdmin = this.isAdminFromPayload(p);
          this.msg = 'Ingreso correcto ✅';
          this.router.navigate([ isAdmin ? '/admin' : '/' ]);
        },
        error: (err) => {
          // HttpClient ya parsea JSON; si el server devolviera HTML, entra aquí
          // y mostramos un mensaje claro.
          const serverMsg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : '') ||
            '';
          this.msg = serverMsg || 'Credenciales inválidas o ruta /auth/login no accesible desde el front';
        },
        complete: () => (this.loading = false)
      });
  }
}
