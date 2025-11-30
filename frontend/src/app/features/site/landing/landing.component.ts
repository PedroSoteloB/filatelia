// // src/app/features/site/landing/landing.component.ts
// import { Component, OnInit, Inject } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { FormsModule } from '@angular/forms';
// import { Router } from '@angular/router';
// import { PLATFORM_ID } from '@angular/core';

// type PublicItem = {
//   id: number;
//   title: string;
//   country: string | null;
//   issueYear: number | null;
//   cover: string | null; // el backend hoy devuelve una ruta local; mostramos placeholder
// };

// @Component({
//   selector: 'app-landing',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './landing.component.html',
//   styleUrls: ['./landing.component.scss']
// })
// export class LandingComponent implements OnInit {
//   // estado auth / UI
//   isAuth = false;
//   isAdmin = false;
//   isBrowser = false;

//   // catálogo público
//   items: PublicItem[] = [];
//   q = '';
//   loading = false;
//   canLoadMore = true;
//   private offset = 0;
//   private readonly limit = 12;

//   // 👇 NUEVO: criterio de ordenamiento en el cliente
//   sortBy: 'server' | 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' = 'server';

//   constructor(
//     private router: Router,
//     @Inject(PLATFORM_ID) private platformId: Object
//   ) {}
//   currentYear = new Date().getFullYear();

//   ngOnInit(): void {
//     this.isBrowser = isPlatformBrowser(this.platformId);

//     // Auth (solo en navegador)
//     if (this.isBrowser) {
//       const token =
//         localStorage.getItem('accessToken') ??
//         sessionStorage.getItem('accessToken') ??
//         '';

//       this.isAuth = !!token;
//       const role = getRoleFromToken(token);
//       this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
//     }

//     // Cargar catálogo público de inicio
//     if (this.isBrowser) this.loadPublic(true).catch(() => {});
//   }

//   goPublicDetail(id: number): void {
//     this.router.navigate(['/item', id]);
//   }

//   // ======================
//   // NAV
//   // ======================
//   goInicio() { this.router.navigateByUrl('/'); }

//   // ✔️ Login con returnUrl (por defecto, vuelve a la URL actual)
//   goLogin(returnUrl: string = this.router.url) {
//     this.router.navigate(['/login'], { queryParams: { returnUrl } });
//   }

//   // Helper: si no hay sesión, manda a login preservando destino
//   private navigateOrLogin(targetUrl: string) {
//     if (!this.isAuth) { this.goLogin(targetUrl); return; }
//     this.router.navigateByUrl(targetUrl);
//   }

//   // NUEVA PIEZA
//   goUpload() { this.navigateOrLogin('/items/upload'); }

//   // MIS ITEMS (lista privada)
//   goMyItems() { this.navigateOrLogin('/items/mine'); }

//   // BÚSQUEDA (pública)
//   goSearch() { this.router.navigateByUrl('/items/search'); }

//   // MIS COLECCIONES
//   goCollections() { this.navigateOrLogin('/collections'); }

//   goPresentation() { this.navigateOrLogin('/presentations'); }

//   // Mantengo por compatibilidad: redirige al listado privado
//   goMyCatalog() { this.goMyItems(); }

//   logout() {
//     if (!this.isBrowser) return;

//     const refresh =
//       localStorage.getItem('refreshToken') ??
//       sessionStorage.getItem('refreshToken');

//     fetch('/auth/logout', {
//       method: 'POST',
//       headers: { 'Content-Type':'application/json' },
//       body: JSON.stringify({ refreshToken: refresh })
//     }).catch(() => {});

//     localStorage.clear();
//     sessionStorage.clear();
//     this.isAuth = false;
//     this.isAdmin = false;
//     this.router.navigate(['/']);
//   }

//   scrollToCatalog() {
//     if (!this.isBrowser) return;
//     const el = document.getElementById('catalogo');
//     if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
//   }

//   // Catálogo público
//   async search() { await this.loadPublic(true); }
//   async loadMore() { await this.loadPublic(false); }

//   private async loadPublic(reset: boolean) {
//     if (this.loading) return;

//     if (reset) {
//       this.offset = 0;
//       this.items = [];
//       this.canLoadMore = true;
//     }
//     if (!this.canLoadMore) return;

//     this.loading = true;
//     try {
//       const params = new URLSearchParams({
//         offset: String(this.offset),
//         limit: String(this.limit)
//       });
//       if (this.q.trim()) params.set('q', this.q.trim());

//       const r = await fetch(`/public/items?${params.toString()}`);
//       const data: PublicItem[] = await r.json().catch(() => []);
//       if (!r.ok) throw data as any;

//       this.items = this.items.concat(data);
//       this.offset += data.length;

//       // 👇 NUEVO: ordenar en cliente si el usuario no está en "Novedades"
//       if (this.sortBy !== 'server') this.sortItems();

//       if (data.length < this.limit) this.canLoadMore = false;
//     } finally {
//       this.loading = false;
//     }
//   }

//   // 👇 NUEVO: ordenamiento en cliente
//   sortItems() {
//     if (this.sortBy === 'server') return; // respeta el orden por defecto del backend
//     const byTitleAsc = (a:PublicItem,b:PublicItem) =>
//       (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
//     const byYearAsc = (a:PublicItem,b:PublicItem) =>
//       (a.issueYear ?? Infinity) - (b.issueYear ?? Infinity);

//     switch (this.sortBy) {
//       case 'title_asc':  this.items = [...this.items].sort(byTitleAsc); break;
//       case 'title_desc': this.items = [...this.items].sort((a,b)=>-byTitleAsc(a,b)); break;
//       case 'year_asc':   this.items = [...this.items].sort(byYearAsc); break;
//       case 'year_desc':  this.items = [...this.items].sort((a,b)=>-byYearAsc(a,b)); break;
//     }
//   }
// }

// function getRoleFromToken(token: string): any {
//   if (!token) return undefined;
//   try {
//     const payload = JSON.parse(
//       atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
//     );
//     return payload.role ?? payload.roles ?? payload.permissions;
//   } catch {
//     return undefined;
//   }
// }
// src/app/features/site/landing/landing.component.ts
import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

// 👇 IMPORTA environment (si la ruta falla, usa Ctrl+. en VSCode para corregirla)
import { environment } from '../../../core/environments/environment';

// Base del backend (Azure)
const API_BASE = environment.apiBaseUrl;

type PublicItem = {
  id: number;
  title: string;
  country: string | null;
  issueYear: number | null;
  cover: string | null; // el backend hoy devuelve una ruta local; mostramos placeholder
};

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent implements OnInit {
  // estado auth / UI
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // catálogo público
  items: PublicItem[] = [];
  q = '';
  loading = false;
  canLoadMore = true;
  private offset = 0;
  private readonly limit = 12;

  // 👇 criterio de ordenamiento en el cliente
  sortBy: 'server' | 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' = 'server';

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  currentYear = new Date().getFullYear();

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);

    // Auth (solo en navegador)
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      this.isAuth = !!token;
      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
    }

    // Cargar catálogo público de inicio
    // if (this.isBrowser) this.loadPublic(true).catch(() => {});
  }

  goPublicDetail(id: number): void {
    this.router.navigate(['/item', id]);
  }

  // ======================
  // NAV
  // ======================
  goInicio() { this.router.navigateByUrl('/'); }

  // ✔️ Login con returnUrl (por defecto, vuelve a la URL actual)
  goLogin(returnUrl: string = this.router.url) {
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }

  // Helper: si no hay sesión, manda a login preservando destino
  private navigateOrLogin(targetUrl: string) {
    if (!this.isAuth) { this.goLogin(targetUrl); return; }
    this.router.navigateByUrl(targetUrl);
  }

  // NUEVA PIEZA
  goUpload() { this.navigateOrLogin('/items/upload'); }

  // MIS ITEMS (lista privada)
  goMyItems() { this.navigateOrLogin('/items/mine'); }

  // BÚSQUEDA (pública)
  goSearch() { this.router.navigateByUrl('/items/search'); }

  // MIS COLECCIONES
  goCollections() { this.navigateOrLogin('/collections'); }

  goPresentation() { this.navigateOrLogin('/presentations'); }

  // Mantengo por compatibilidad: redirige al listado privado
  goMyCatalog() { this.goMyItems(); }

  logout() {
    if (!this.isBrowser) return;

    const refresh =
      localStorage.getItem('refreshToken') ??
      sessionStorage.getItem('refreshToken');

    // 👇 Ahora pegamos al backend en Azure
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ refreshToken: refresh })
    }).catch(() => {});

    localStorage.clear();
    sessionStorage.clear();
    this.isAuth = false;
    this.isAdmin = false;
    this.router.navigate(['/']);
  }

  scrollToCatalog() {
    if (!this.isBrowser) return;
    const el = document.getElementById('catalogo');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Catálogo público
  // async search() { await this.loadPublic(true); }
  // async loadMore() { await this.loadPublic(false); }
// private async loadPublic(reset: boolean) {
//     if (this.loading) return;

//     if (reset) {
//       this.offset = 0;
//       this.items = [];
//       this.canLoadMore = true;
//     }
//     if (!this.canLoadMore) return;

//     this.loading = true;
//     try {
//       const params = new URLSearchParams({
//         offset: String(this.offset),
//         limit: String(this.limit)
//       });
//       if (this.q.trim()) params.set('q', this.q.trim());

//       // 👇 ahora llama al backend en Azure
//       const r = await fetch(`${API_BASE}/public/items?${params.toString()}`);
//       const data: PublicItem[] = await r.json().catch(() => []);
//       if (!r.ok) throw data as any;

//       this.items = this.items.concat(data);
//       this.offset += data.length;

//       // 👇 ordenar en cliente si el usuario no está en "Novedades"
//       if (this.sortBy !== 'server') this.sortItems();

//       if (data.length < this.limit) this.canLoadMore = false;
//     } finally {
//       this.loading = false;
//     }
//   }
  

  // 👇 ordenamiento en cliente
  sortItems() {
    if (this.sortBy === 'server') return; // respeta el orden por defecto del backend
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
