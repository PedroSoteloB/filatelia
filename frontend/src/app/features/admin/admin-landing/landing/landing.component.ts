// src/app/features/admin/landing/landing.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

// 👇 environment
import { environment } from '../../../../core/environments/environment.prod';

const API_BASE = environment.apiBaseUrl;

// ===== Helper decode JWT =====
function decode(token: string): any {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
}

@Component({
  selector: 'app-admin-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
})
export class LandingComponent implements OnInit {
  // ===== UI / Auth =====
  displayName = 'Administrador';
  isAuth = false;
  isBrowser = false;

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (!this.isBrowser) return;

    const token =
      localStorage.getItem('accessToken') ??
      sessionStorage.getItem('accessToken') ??
      '';

    if (!token) {
      this.isAuth = false;
      return;
    }

    this.isAuth = true;

    // 1️⃣ nombre desde storage (login)
    const name =
      localStorage.getItem('displayName') ??
      sessionStorage.getItem('displayName');

    if (name) {
      this.displayName = name;
    } else {
      // 2️⃣ fallback: token
      const p = decode(token);
      this.displayName = p?.name ?? p?.email ?? this.displayName;
    }
  }

  // ===== NAV helpers =====
  goInicio() {
    this.router.navigateByUrl('/');
  }

  goLogin(returnUrl: string = this.router.url) {
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }

  private navigateOrLogin(targetUrl: string) {
    if (!this.isAuth) {
      this.goLogin(targetUrl);
      return;
    }
    this.router.navigateByUrl(targetUrl);
  }

  goUpload() {
    this.navigateOrLogin('/items/upload');
  }

  goMyItems() {
    this.navigateOrLogin('/items/mine');
  }

  goSearch() {
    this.router.navigateByUrl('/items/search');
  }

  goCollections() {
    this.navigateOrLogin('/collections');
  }

  goPresentation() {
    this.navigateOrLogin('/presentations');
  }

  goMyCatalog() {
    this.goMyItems();
  }

  goDashboard() {
    this.router.navigate(['/items/stats']);
  }

  // ===== LOGOUT =====
  async logout() {
    if (!this.isBrowser) return;

    const refresh =
      localStorage.getItem('refreshToken') ??
      sessionStorage.getItem('refreshToken');

    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
    } catch {
      // si falla igual limpiamos sesión
    }

    localStorage.clear();
    sessionStorage.clear();
    this.isAuth = false;
    this.router.navigate(['/login']);
  }
}
