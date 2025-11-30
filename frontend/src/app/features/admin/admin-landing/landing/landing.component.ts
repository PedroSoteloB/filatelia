// import { Component, Inject, OnInit } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { Router, RouterLink } from '@angular/router';
// import { PLATFORM_ID } from '@angular/core';

// @Component({
//   selector: 'app-admin-landing',
//   standalone: true,
//   imports: [CommonModule, RouterLink],
//   templateUrl: './landing.component.html',
//   styleUrls: ['./landing.component.scss']
// })
// export class LandingComponent implements OnInit {
//   displayName = 'Administrador';

//   constructor(
//     private router: Router,
//     @Inject(PLATFORM_ID) private platformId: Object
//   ) {}

//   ngOnInit(): void {
//     if (!isPlatformBrowser(this.platformId)) return; // SSR-safe

//     // 1) Intentamos tomar el nombre guardado en el login
//     const name =
//       localStorage.getItem('displayName') ??
//       sessionStorage.getItem('displayName');

//     if (name) this.displayName = name;
//     else {
//       // 2) Fallback: decodificar del token
//       const token =
//         localStorage.getItem('accessToken') ??
//         sessionStorage.getItem('accessToken') ?? '';
//       const p = decode(token);
//       this.displayName = p?.name ?? p?.email ?? this.displayName;
//     }
//   }

//   async logout() {
//     if (!isPlatformBrowser(this.platformId)) return;
//     const refresh = localStorage.getItem('refreshToken') ?? sessionStorage.getItem('refreshToken');
//     try {
//       await fetch('/auth/logout', {
//         method: 'POST',
//         headers: { 'Content-Type':'application/json' },
//         body: JSON.stringify({ refreshToken: refresh })
//       });
//     } catch {}
//     localStorage.clear(); sessionStorage.clear();
//     this.router.navigate(['/login']);
//   }
// }

// function decode(token: string): any {
//   try {
//     const base64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
//     return JSON.parse(atob(base64));
//   } catch { return {}; }
// }
// src/app/features/admin/landing/landing.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

// 👇 IMPORTA environment (ajusta la ruta si no coincide)
import { environment } from '../../../../core/environments/environment.prod';

const API_BASE = environment.apiBaseUrl;

@Component({
  selector: 'app-admin-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent implements OnInit {
  displayName = 'Administrador';

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return; // SSR-safe

    // 1) Intentamos tomar el nombre guardado en el login
    const name =
      localStorage.getItem('displayName') ??
      sessionStorage.getItem('displayName');

    if (name) this.displayName = name;
    else {
      // 2) Fallback: decodificar del token
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';
      const p = decode(token);
      this.displayName = p?.name ?? p?.email ?? this.displayName;
    }
  }

  async logout() {
    if (!isPlatformBrowser(this.platformId)) return;

    const refresh =
      localStorage.getItem('refreshToken') ??
      sessionStorage.getItem('refreshToken');

    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ refreshToken: refresh })
      });
    } catch {}

    localStorage.clear();
    sessionStorage.clear();
    this.router.navigate(['/login']);
  }
}

function decode(token: string): any {
  try {
    const base64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(base64));
  } catch { return {}; }
}
