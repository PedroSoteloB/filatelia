
// src/app/features/site/landing/landing.component.ts
import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { environment } from '../../../core/environments/environment';

const API_BASE = environment.apiBaseUrl;

type PublicItem = {
  id: number;
  title: string;
  country: string | null;
  issueYear: number | null;
  cover: string | null;
};

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent implements OnInit {
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // 👇 NUEVO: nombre a mostrar en navbar
  displayName = '';

  items: PublicItem[] = [];
  q = '';
  loading = false;
  canLoadMore = true;
  private offset = 0;
  private readonly limit = 12;

  sortBy: 'server' | 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' = 'server';

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  currentYear = new Date().getFullYear();

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);

    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      this.isAuth = !!token;

      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';

      // 👇 NUEVO: cargar displayName como en admin
      this.displayName = getDisplayName(token);
    }

    // if (this.isBrowser) this.loadPublic(true).catch(() => {});
  }

  goPublicDetail(id: number): void {
    this.router.navigate(['/item', id]);
  }

  goInicio() { this.router.navigateByUrl('/'); }

  goLogin(returnUrl: string = this.router.url) {
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }

  goRegister() {
    this.router.navigate(['/register']);
  }

  private navigateOrLogin(targetUrl: string) {
    if (!this.isAuth) { this.goLogin(targetUrl); return; }
    this.router.navigateByUrl(targetUrl);
  }

  goUpload() { this.navigateOrLogin('/items/upload'); }
  goMyItems() { this.navigateOrLogin('/items/mine'); }
  goSearch() { this.router.navigateByUrl('/items/search'); }
  goCollections() { this.navigateOrLogin('/collections'); }
  goPresentation() { this.navigateOrLogin('/presentations'); }
  goMyCatalog() { this.goMyItems(); }

  logout() {
    if (!this.isBrowser) return;

    const refresh =
      localStorage.getItem('refreshToken') ??
      sessionStorage.getItem('refreshToken');

    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ refreshToken: refresh })
    }).catch(() => {});

    localStorage.clear();
    sessionStorage.clear();
    this.isAuth = false;
    this.isAdmin = false;
    this.displayName = '';
    this.router.navigate(['/']);
  }

  scrollToCatalog() {
    if (!this.isBrowser) return;
    const el = document.getElementById('catalogo');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  goDashboard() {
    this.router.navigate(['/items/stats']);
  }

  sortItems() {
    if (this.sortBy === 'server') return;
    const byTitleAsc = (a:PublicItem,b:PublicItem) =>
      (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
    const byYearAsc = (a:PublicItem,b:PublicItem) =>
      (a.issueYear ?? Infinity) - (b.issueYear ?? Infinity);

    switch (this.sortBy) {
      case 'title_asc':  this.items = [...this.items].sort(byTitleAsc); break;
      case 'title_desc': this.items = [...this.items].sort((a,b)=>-byTitleAsc(a,b)); break;
      case 'year_asc':   this.items = [...this.items].sort(byYearAsc); break;
      case 'year_desc':  this.items = [...this.items].sort((a,b)=>-byYearAsc(a,b)); break;
    }
  }
}

function getRoleFromToken(token: string): any {
  if (!token) return undefined;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
    );
    return payload.role ?? payload.roles ?? payload.permissions;
  } catch {
    return undefined;
  }
}

// 👇 NUEVO: igual idea que admin, pero centralizado
function getDisplayName(token: string): string {
  // 1) primero intenta storage (por si en login lo guardas)
  const stored =
    (typeof window !== 'undefined'
      ? (localStorage.getItem('displayName') ?? sessionStorage.getItem('displayName'))
      : null);

  if (stored) return stored;

  // 2) fallback: decodificar token
  if (!token) return '';
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
    );
    return payload?.name ?? payload?.displayName ?? payload?.email ?? '';
  } catch {
    return '';
  }
}
