// // src/app/features/auth/forgot-password/forgot-password.component.ts
// import { Component } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormsModule } from '@angular/forms';
// import { Router } from '@angular/router';

// @Component({
//   selector: 'app-forgot-password',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './forgot-password.component.html',
//   styleUrls: ['./forgot-password.component.scss']
// })
// export class ForgotPasswordComponent {
//   email = '';
//   loading = false;
//   msg = '';
//   resetLink = ''; // 👈 opcional: para mostrar el link en UI durante dev

//   constructor(private router: Router) {}

//   async submit() {
//     this.loading = true;
//     this.msg = '';
//     this.resetLink = '';

//     try {
//       const email = this.email.trim();
//       if (!email) {
//         this.msg = 'Ingresa tu correo';
//         return;
//       }

//       const r = await fetch('/auth/forgot-password', {
//         method: 'POST',
//         headers: { 'Content-Type':'application/json' },
//         body: JSON.stringify({ email })
//       });

//       // intenta leer JSON aunque haya error para obtener {message}
//       const res = await r.json().catch(() => ({} as any));
//       if (!r.ok) throw res;

//       // En dev: si el back devuelve resetLink, usarlo para navegar directo
//       if (res.resetLink) {
//         this.resetLink = res.resetLink;                      // 👈 útil para mostrarlo en UI si quieres
//         console.log('[DEV] resetLink:', this.resetLink);     // 👈 visible en consola del navegador

//         const url = new URL(this.resetLink);
//         const token = url.searchParams.get('token') ?? '';
//         await this.router.navigate(['/reset-password'], { queryParams: { token } });
//       } else {
//         // Respuesta neutra cuando el email no existe (anti-enumeración)
//         this.msg = 'Si el email existe, enviaremos instrucciones a tu correo ✅';
//       }
//     } catch (e: any) {
//       this.msg = e?.message || 'Hubo un error, intenta nuevamente';
//     } finally {
//       this.loading = false;
//     }
//   }
// }

// src/app/features/auth/forgot-password/forgot-password.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// 👇 IMPORTA environment (si la ruta falla, usa Ctrl+. sobre "environment")
import { environment } from '../../../core/environments/environment';

// Base del backend (Azure)
const API_BASE = environment.apiBaseUrl;

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss']
})
export class ForgotPasswordComponent {
  email = '';
  loading = false;
  msg = '';
  resetLink = ''; // 👈 opcional: para mostrar el link en UI durante dev

  constructor(private router: Router) {}

  async submit() {
    this.loading = true;
    this.msg = '';
    this.resetLink = '';

    try {
      const email = this.email.trim();
      if (!email) {
        this.msg = 'Ingresa tu correo';
        return;
      }

      // 👇 ahora apunta al backend en Azure
      const r = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ email })
      });

      // intenta leer JSON aunque haya error para obtener {message}
      const res = await r.json().catch(() => ({} as any));
      if (!r.ok) throw res;

      // En dev: si el back devuelve resetLink, usarlo para navegar directo
      if (res.resetLink) {
        this.resetLink = res.resetLink;
        console.log('[DEV] resetLink:', this.resetLink);

        const url = new URL(this.resetLink);
        const token = url.searchParams.get('token') ?? '';
        await this.router.navigate(['/reset-password'], { queryParams: { token } });
      } else {
        // Respuesta neutra cuando el email no existe (anti-enumeración)
        this.msg = 'Si el email existe, enviaremos instrucciones a tu correo ✅';
      }
    } catch (e: any) {
      this.msg = e?.message || 'Hubo un error, intenta nuevamente';
    } finally {
      this.loading = false;
    }
  }
}
