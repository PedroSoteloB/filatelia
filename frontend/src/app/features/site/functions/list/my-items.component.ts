// // import { Component, inject, signal, computed, ViewEncapsulation } from '@angular/core';
// // import { CommonModule } from '@angular/common';
// // import { HttpClient, HttpHeaders, HttpClientModule } from '@angular/common/http';

// // type MyItem = {
// //   id: number;
// //   title: string;
// //   country: string | null;
// //   issueYear: number | null;
// //   cover: string | null; // file_path absoluto/relativo
// // };

// // type Order = 'created_at_desc' | 'created_at_asc';

// // const ENDPOINT = '/me/items';

// // @Component({
// //   selector: 'app-my-items',
// //   standalone: true,
// //   imports: [CommonModule, HttpClientModule],
// //   templateUrl: './my-items.component.html',
// //   styleUrls: ['./my-items.component.scss'],
// //   encapsulation: ViewEncapsulation.None,
// //   host: { class: 'my-items-page' },
// // })
// // export class MyItemsComponent {
// //   private http = inject(HttpClient);

// //   // estado UI
// //   items = signal<MyItem[]>([]);
// //   busy = signal(false);
// //   error = signal<string | null>(null);

// //   // paginación
// //   limit = 20;
// //   offset = signal(0);
// //   hasMore = signal(true);

// //   // orden
// //   order = signal<Order>('created_at_desc');

// //   // helpers
// //   private buildHeaders(): HttpHeaders {
// //     const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
// //     return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
// //   }

// //   // carga inicial
// //   ngOnInit() { this.reload(); }

// //   async reload() {
// //     this.items.set([]);
// //     this.offset.set(0);
// //     this.hasMore.set(true);
// //     await this.fetchPage(true);
// //   }

// //   async fetchPage(reset = false) {
// //     if (this.busy() || !this.hasMore()) return;
// //     this.busy.set(true);
// //     this.error.set(null);

// //     try {
// //       const params = new URLSearchParams();
// //       params.set('limit', String(this.limit));
// //       params.set('order', this.order());               // 'created_at_desc' | 'created_at_asc'
// //       params.set('offset', String(this.offset()));     // paginación simple

// //       const res = await this.http.get<MyItem[]>(
// //         `${ENDPOINT}?${params.toString()}`,
// //         { headers: this.buildHeaders() }
// //       ).toPromise();

// //       const page = Array.isArray(res) ? res : [];
// //       if (reset) this.items.set(page);
// //       else this.items.set([...this.items(), ...page]);

// //       // actualizar offset y hasMore
// //       this.offset.set(this.offset() + page.length);
// //       this.hasMore.set(page.length === this.limit);
// //     } catch (e: any) {
// //       this.error.set(e?.error?.message || e?.message || 'Error cargando tus ítems');
// //       this.hasMore.set(false);
// //     } finally {
// //       this.busy.set(false);
// //     }
// //   }

// //   async loadMore() { await this.fetchPage(); }

// //   // handler para el <select> del template
// //   onOrderChange(val: string) {
// //     const v: Order = (val === 'created_at_asc') ? 'created_at_asc' : 'created_at_desc';
// //     this.order.set(v);
// //     this.reload();
// //   }

// //   // presentación
// //   total = computed(() => this.items().length);

// //   coverUrl(i: MyItem) {
// //     return i.cover || '';
// //   }
// // }

// import { Component, inject, signal, computed, ViewEncapsulation } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { HttpClient, HttpHeaders, HttpClientModule } from '@angular/common/http';
// import { RouterModule } from '@angular/router'; // ✅ ÚNICA LÍNEA AÑADIDA

// type MyItem = {
//   id: number;
//   title: string;
//   country: string | null;
//   issueYear: number | null;
//   cover: string | null; // file_path absoluto/relativo
// };

// type Order = 'created_at_desc' | 'created_at_asc';

// const ENDPOINT = '/me/items';

// @Component({
//   selector: 'app-my-items',
//   standalone: true,
//   imports: [CommonModule, HttpClientModule, RouterModule], // ✅ SOLO se añadió RouterModule aquí
//   templateUrl: './my-items.component.html',
//   styleUrls: ['./my-items.component.scss'],
//   encapsulation: ViewEncapsulation.None,
//   host: { class: 'my-items-page' },
// })
// export class MyItemsComponent {
//   private http = inject(HttpClient);

//   // estado UI
//   items = signal<MyItem[]>([]);
//   busy = signal(false);
//   error = signal<string | null>(null);

//   // paginación
//   limit = 20;
//   offset = signal(0);
//   hasMore = signal(true);

//   // orden
//   order = signal<Order>('created_at_desc');

//   // helpers
//   private buildHeaders(): HttpHeaders {
//     const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
//     return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
//   }

//   // carga inicial
//   ngOnInit() { this.reload(); }

//   async reload() {
//     this.items.set([]);
//     this.offset.set(0);
//     this.hasMore.set(true);
//     await this.fetchPage(true);
//   }

//   async fetchPage(reset = false) {
//     if (this.busy() || !this.hasMore()) return;
//     this.busy.set(true);
//     this.error.set(null);

//     try {
//       const params = new URLSearchParams();
//       params.set('limit', String(this.limit));
//       params.set('order', this.order());               // 'created_at_desc' | 'created_at_asc'
//       params.set('offset', String(this.offset()));     // paginación simple

//       const res = await this.http.get<MyItem[]>(
//         `${ENDPOINT}?${params.toString()}`,
//         { headers: this.buildHeaders() }
//       ).toPromise();

//       const page = Array.isArray(res) ? res : [];
//       if (reset) this.items.set(page);
//       else this.items.set([...this.items(), ...page]);

//       // actualizar offset y hasMore
//       this.offset.set(this.offset() + page.length);
//       this.hasMore.set(page.length === this.limit);
//     } catch (e: any) {
//       this.error.set(e?.error?.message || e?.message || 'Error cargando tus ítems');
//       this.hasMore.set(false);
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   async loadMore() { await this.fetchPage(); }

//   // handler para el <select> del template
//   onOrderChange(val: string) {
//     const v: Order = (val === 'created_at_asc') ? 'created_at_asc' : 'created_at_desc';
//     this.order.set(v);
//     this.reload();
//   }

//   // presentación
//   total = computed(() => this.items().length);

//   coverUrl(i: MyItem) {
//     return i.cover || '';
//   }
// }

import { Component, inject, signal, computed, ViewEncapsulation, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders, HttpClientModule } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

type MyItem = {
  id: number;
  title: string;
  country: string | null;
  issueYear: number | null;
  cover: string | null; // file_path absoluto/relativo
};

type Order = 'created_at_desc' | 'created_at_asc';

const ENDPOINT = '/me/items';

// ==== Helpers JWT (roles y expiración) ====
function getRoleFromToken(token: string): any {
  if (!token) return undefined;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
    );
    return payload.role ?? payload.roles ?? payload.permissions;
  } catch { return undefined; }
}
function isExpired(token: string): boolean {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return typeof exp === 'number' && Date.now() / 1000 >= exp;
  } catch { return true; }
}

@Component({
  selector: 'app-my-items',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule],
  templateUrl: './my-items.component.html',
  styleUrls: ['./my-items.component.scss'],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'my-items-page' },
})
export class MyItemsComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // auth/ui
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // estado UI
  items = signal<MyItem[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);

  // paginación
  limit = 20;
  offset = signal(0);
  hasMore = signal(true);

  // orden
  order = signal<Order>('created_at_desc');

  ngOnInit() {
    // === auth / roles ===
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      if (!token || isExpired(token)) {
        localStorage.clear();
        sessionStorage.clear();
        this.isAuth = false;
        this.isAdmin = false;
        // como es sección privada, mándala a login con returnUrl
        this.goLogin(this.router.url);
        return;
      }

      this.isAuth = true;
      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
    }

    // carga inicial
    this.reload();
  }

  // ===== NAV helpers (por si el header de la vista los usa) =====
  goInicio() { this.router.navigateByUrl('/'); }
  goLogin(returnUrl: string = this.router.url) {
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
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
    const refresh = localStorage.getItem('refreshToken') ?? sessionStorage.getItem('refreshToken');
    fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ refreshToken: refresh })
    }).catch(() => {});
    localStorage.clear(); sessionStorage.clear();
    this.isAuth = false; this.isAdmin = false;
    this.router.navigate(['/']);
  }

  // ===== API helpers =====
  private buildHeaders(): HttpHeaders {
    const token = this.isBrowser
      ? (localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '')
      : '';
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  // ===== Data loading =====
  async reload() {
    this.items.set([]);
    this.offset.set(0);
    this.hasMore.set(true);
    await this.fetchPage(true);
  }

  async fetchPage(reset = false) {
    if (this.busy() || !this.hasMore()) return;
    this.busy.set(true);
    this.error.set(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(this.limit));
      params.set('order', this.order());               // 'created_at_desc' | 'created_at_asc'
      params.set('offset', String(this.offset()));     // paginación simple

      const res = await this.http.get<MyItem[]>(
        `${ENDPOINT}?${params.toString()}`,
        { headers: this.buildHeaders() }
      ).toPromise();

      const page = Array.isArray(res) ? res : [];
      if (reset) this.items.set(page);
      else this.items.set([...this.items(), ...page]);

      // actualizar offset y hasMore
      this.offset.set(this.offset() + page.length);
      this.hasMore.set(page.length === this.limit);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || 'Error cargando tus ítems');
      this.hasMore.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  async loadMore() { await this.fetchPage(); }

  onOrderChange(val: string) {
    const v: Order = (val === 'created_at_asc') ? 'created_at_asc' : 'created_at_desc';
    this.order.set(v);
    this.reload();
  }

  total = computed(() => this.items().length);

  coverUrl(i: MyItem) {
    return i.cover || '';
  }
}
