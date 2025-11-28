// import { Component, inject, signal, computed, OnInit, Inject } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { Router, RouterLink } from '@angular/router';
// import { HttpClient, HttpHeaders } from '@angular/common/http';
// import { firstValueFrom } from 'rxjs';
// import { PLATFORM_ID } from '@angular/core';

// /**
//  * Coincide con lo que devuelve GET /collections del backend
//  */
// export type CollectionRow = {
//   id: number;
//   name: string;
//   description: string | null;
//   type: 'smart' | 'static';
//   filter_json: any;           // puede venir string, objeto o null
//   sort_key: string | null;
//   sort_dir: 'asc' | 'desc' | null;
//   created_at: string;
//   updated_at: string;
// };

// // ==== Helpers JWT (roles y expiración) ====
// function getRoleFromToken(token: string): any {
//   if (!token) return undefined;
//   try {
//     const payload = JSON.parse(
//       atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
//     );
//     return payload.role ?? payload.roles ?? payload.permissions;
//   } catch { return undefined; }
// }
// function isExpired(token: string): boolean {
//   try {
//     const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
//     return typeof exp === 'number' && Date.now()/1000 >= exp;
//   } catch { return true; }
// }

// @Component({
//   selector: 'app-collections-list',
//   standalone: true,
//   imports: [CommonModule, RouterLink],
//   templateUrl: './collections-list.component.html',
//   styleUrls: ['./collections-list.component.scss'],
//   host: { class: 'collections-page' }
// })
// export class CollectionsListComponent implements OnInit {
//   private http = inject(HttpClient);
//   private router = inject(Router);

//   constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

//   // ===== Auth / UI =====
//   isAuth = false;
//   isAdmin = false;
//   isBrowser = false;

//   // estado de UI
//   busy        = signal<boolean>(false);
//   error       = signal<string | null>(null);
//   collections = signal<CollectionRow[]>([]);

//   // derivado: cuántas hay de cada tipo
//   smartCount = computed(() =>
//     this.collections().filter(c => c.type === 'smart').length
//   );
//   staticCount = computed(() =>
//     this.collections().filter(c => c.type === 'static').length
//   );

//   async ngOnInit() {
//     // === auth / roles ===
//     this.isBrowser = isPlatformBrowser(this.platformId);
//     if (this.isBrowser) {
//       const token =
//         localStorage.getItem('accessToken') ??
//         sessionStorage.getItem('accessToken') ??
//         '';

//       if (!token || isExpired(token)) {
//         if (token) { localStorage.clear(); sessionStorage.clear(); }
//         this.isAuth = false;
//         this.isAdmin = false;
//         // Vista privada: redirige a login con returnUrl
//         this.goLogin(this.router.url);
//         return;
//       }

//       this.isAuth = true;
//       const role = getRoleFromToken(token);
//       this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
//     }

//     await this.loadCollections();
//   }

//   // ===== NAV (usado por el header del template) =====
//   goInicio() { this.router.navigateByUrl('/'); }

//   goLogin(returnUrl: string = this.router.url) {
//     this.router.navigate(['/login'], { queryParams: { returnUrl } });
//   }

//   private navigateOrLogin(targetUrl: string) {
//     if (!this.isAuth) { this.goLogin(targetUrl); return; }
//     this.router.navigateByUrl(targetUrl);
//   }

//   goUpload() { this.navigateOrLogin('/items/upload'); }
//   goMyItems() { this.navigateOrLogin('/items/mine'); }
//   goSearch() { this.router.navigateByUrl('/items/search'); }
//   goCollections() { this.navigateOrLogin('/collections'); }
//   goPresentation() { this.navigateOrLogin('/presentations'); }

//   logout() {
//     if (!this.isBrowser) return;
//     const refresh = localStorage.getItem('refreshToken') ?? sessionStorage.getItem('refreshToken');
//     fetch('/auth/logout', {
//       method: 'POST',
//       headers: { 'Content-Type':'application/json' },
//       body: JSON.stringify({ refreshToken: refresh })
//     }).catch(() => {});
//     localStorage.clear(); sessionStorage.clear();
//     this.isAuth = false; this.isAdmin = false;
//     this.router.navigate(['/']);
//   }

//   // ===== headers protegidos =====
//   private authHeaders(): HttpHeaders {
//     if (!this.isBrowser) return new HttpHeaders();
//     const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
//     return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
//   }

//   /**
//    * Llama GET /collections (protegido)
//    */
//   async loadCollections() {
//     try {
//       this.busy.set(true);
//       this.error.set(null);

//       const rows = await firstValueFrom(
//         this.http.get<CollectionRow[]>('/collections', { headers: this.authHeaders() })
//       );

//       // Normalizar filter_json para que sea un objeto parseable en el front
//       const normalized = (rows || []).map(row => ({
//         ...row,
//         filter_json: this.ensureParsedJson(row.filter_json)
//       }));

//       this.collections.set(normalized);
//     } catch (e: any) {
//       this.error.set(e?.error?.message || e?.message || 'No se pudieron cargar las colecciones');
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   /**
//    * filter_json puede venir:
//    *   - ya como objeto,
//    *   - como string JSON,
//    *   - como Buffer,
//    *   - o null.
//    * Lo convertimos a objeto o null.
//    */
//   private ensureParsedJson(raw: any): any {
//     if (raw == null) return null;

//     // si ya es objeto simple y no es Buffer
//     if (typeof raw === 'object' && !(typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(raw))) {
//       return raw;
//     }

//     // si es string JSON
//     if (typeof raw === 'string') {
//       try {
//         return JSON.parse(raw);
//       } catch {
//         return null;
//       }
//     }

//     // si es Buffer u otra cosa rara
//     try {
//       if (typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(raw)) {
//         const txt = (raw as any).toString('utf8');
//         return JSON.parse(txt);
//       }
//     } catch {
//       // ignorar error
//     }

//     return null;
//   }

//   /**
//    * Muestra un resumen "humano" del filtro de una colección SMART
//    */
//   previewFilter(c: CollectionRow): string {
//     if (c.type !== 'smart') return '';
//     const f: any = c.filter_json || {};
//     const parts: string[] = [];

//     if (f.country) parts.push(`País=${f.country}`);
//     if (f.condition) parts.push(`Condición=${f.condition}`);
//     if (f.yearFrom != null || f.yearTo != null) {
//       parts.push(`Años ${f.yearFrom ?? '…'}-${f.yearTo ?? '…'}`);
//     }
//     if (Array.isArray(f.tagIds) && f.tagIds.length) {
//       parts.push(`Tags ${f.tagsMode || 'OR'} [${f.tagIds.join(', ')}]`);
//     }
//     if (Array.isArray(f.attrs) && f.attrs.length) {
//       parts.push(`Atributos(${f.attrs.length})`);
//     }

//     return parts.join(' · ');
//   }

//   /**
//    * Formatea fecha tipo "2025-10-26 12:32"
//    */
//   fmtDate(d: string | null | undefined) {
//     if (!d) return '';
//     const dt = new Date(d);
//     const yyyy = dt.getFullYear();
//     const mm   = String(dt.getMonth() + 1).padStart(2, '0');
//     const dd   = String(dt.getDate()).padStart(2, '0');
//     const hh   = String(dt.getHours()).padStart(2, '0');
//     const mi   = String(dt.getMinutes()).padStart(2, '0');
//     return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
//   }

//   /**
//    * Construimos el enlace al detalle de la colección.
//    */
//   buildDetailLink(c: CollectionRow): any[] {
//     return ['/collections', c.id];
//   }

//   /**
//    * Llama DELETE /collections/:id (protegido)
//    */
//   async deleteCollection(c: CollectionRow) {
//     const ok = confirm(`¿Eliminar la colección "${c.name}"? Esta acción no se puede deshacer.`);
//     if (!ok) return;

//     try {
//       this.busy.set(true);
//       this.error.set(null);

//       await firstValueFrom(this.http.delete(`/collections/${c.id}`, { headers: this.authHeaders() }));

//       // actualizar el listado local
//       this.collections.set(this.collections().filter(x => x.id !== c.id));
//     } catch (e: any) {
//       this.error.set(e?.error?.message || e?.message || 'No se pudo eliminar la colección');
//     } finally {
//       this.busy.set(false);
//     }
//   }
// }


// // // pasado
// //  import { Component, inject, signal, computed } from '@angular/core';
// // import { CommonModule } from '@angular/common';
// // import { RouterLink } from '@angular/router';
// // import { HttpClient } from '@angular/common/http';
// // import { firstValueFrom } from 'rxjs';

// // /**
// //  * Coincide con lo que devuelve GET /collections del backend
// //  */
// // export type CollectionRow = {
// //   id: number;
// //   name: string;
// //   description: string | null;
// //   type: 'smart' | 'static';
// //   filter_json: any;           // puede venir string, objeto o null
// //   sort_key: string | null;
// //   sort_dir: 'asc' | 'desc' | null;
// //   created_at: string;
// //   updated_at: string;
// // };

// // @Component({
// //   selector: 'app-collections-list',
// //   standalone: true,
// //   imports: [CommonModule, RouterLink],
// //   templateUrl: './collections-list.component.html',
// //   styleUrls: ['./collections-list.component.scss'],
// //   host: { class: 'collections-page' }   // 👈 ESTA LÍNEA
// // })
// // export class CollectionsListComponent {  
// //   private http = inject(HttpClient);

// //   // estado de UI
// //   busy        = signal<boolean>(false);
// //   error       = signal<string | null>(null);
// //   collections = signal<CollectionRow[]>([]);

// //   // derivado: cuántas hay de cada tipo
// //   smartCount = computed(() =>
// //     this.collections().filter(c => c.type === 'smart').length
// //   );

// //   staticCount = computed(() =>
// //     this.collections().filter(c => c.type === 'static').length
// //   );

// //   constructor() {
// //     this.loadCollections();
// //   }

// //   /**
// //    * Llama GET /collections
// //    */
// //   async loadCollections() {
// //     try {
// //       this.busy.set(true);
// //       this.error.set(null);

// //       const rows = await firstValueFrom(
// //         this.http.get<CollectionRow[]>('/collections')
// //       );

// //       // Normalizar filter_json para que sea un objeto parseable en el front
// //       const normalized = (rows || []).map(row => ({
// //         ...row,
// //         filter_json: this.ensureParsedJson(row.filter_json)
// //       }));

// //       this.collections.set(normalized);
// //     } catch (e: any) {
// //       this.error.set(e?.message || 'No se pudieron cargar las colecciones');
// //     } finally {
// //       this.busy.set(false);
// //     }
// //   }

 
  
// //   /**
// //    * filter_json puede venir:
// //    *   - ya como objeto,
// //    *   - como string JSON,
// //    *   - como Buffer,
// //    *   - o null.
// //    * Lo convertimos a objeto o null.
// //    */
// //   private ensureParsedJson(raw: any): any {
// //     if (raw == null) return null;

// //     // si ya es objeto simple y no es Buffer
// //     if (typeof raw === 'object' && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(raw))) {
// //         return raw;
// //     }

// //     // si es string JSON
// //     if (typeof raw === 'string') {
// //       try {
// //         return JSON.parse(raw);
// //       } catch {
// //         return null;
// //       }
// //     }

// //     // si es Buffer u otra cosa rara
// //     try {
// //       if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
// //         const txt = raw.toString('utf8');
// //         return JSON.parse(txt);
// //       }
// //     } catch {
// //       // ignorar error
// //     }

// //     return null;
// //   }

// //   /**
// //    * Muestra un resumen "humano" del filtro de una colección SMART:
// //    * país, condición, rango de años, tags, attrs.
// //    * No es completo, es preview.
// //    */
// //   previewFilter(c: CollectionRow): string {
// //     if (c.type !== 'smart') return '';
// //     const f: any = c.filter_json || {};
// //     const parts: string[] = [];

// //     if (f.country) parts.push(`País=${f.country}`);
// //     if (f.condition) parts.push(`Condición=${f.condition}`);
// //     if (f.yearFrom != null || f.yearTo != null) {
// //       parts.push(`Años ${f.yearFrom ?? '…'}-${f.yearTo ?? '…'}`);
// //     }
// //     if (Array.isArray(f.tagIds) && f.tagIds.length) {
// //       parts.push(`Tags ${f.tagsMode || 'OR'} [${f.tagIds.join(', ')}]`);
// //     }
// //     if (Array.isArray(f.attrs) && f.attrs.length) {
// //       parts.push(`Atributos(${f.attrs.length})`);
// //     }

// //     return parts.join(' · ');
// //   }

// //   /**
// //    * Formatea fecha tipo "2025-10-26 12:32"
// //    * created_at viene como string desde MySQL.
// //    */
// //   fmtDate(d: string | null | undefined) {
// //     if (!d) return '';
// //     const dt = new Date(d);
// //     const yyyy = dt.getFullYear();
// //     const mm   = String(dt.getMonth() + 1).padStart(2, '0');
// //     const dd   = String(dt.getDate()).padStart(2, '0');
// //     const hh   = String(dt.getHours()).padStart(2, '0');
// //     const mi   = String(dt.getMinutes()).padStart(2, '0');
// //     return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
// //   }

// //   /**
// //    * Construimos el enlace al detalle de la colección.
// //    * Ej.: /collections/12
// //    * (Deberás tener una ruta tipo { path: 'collections/:id', loadComponent: ... })
// //    */
// //   buildDetailLink(c: CollectionRow): any[] {
// //     return ['/collections', c.id];
// //   }

// //   /**
// //    * Llama DELETE /collections/:id
// //    * y quita localmente la colección.
// //    */
// //   async deleteCollection(c: CollectionRow) {
// //     const ok = confirm(`¿Eliminar la colección "${c.name}"? Esta acción no se puede deshacer.`);
// //     if (!ok) return;

// //     try {
// //       this.busy.set(true);
// //       this.error.set(null);

// //       await firstValueFrom(this.http.delete(`/collections/${c.id}`));

// //       // actualizar el listado local
// //       this.collections.set(this.collections().filter(x => x.id !== c.id));
// //     } catch (e: any) {
// //       this.error.set(e?.message || 'No se pudo eliminar la colección');
// //     } finally {
// //       this.busy.set(false);
// //     }
// //   }
// // }
import { Component, inject, signal, computed, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_ID } from '@angular/core';

// 👇 IMPORTA environment (misma ruta que en los otros componentes de features)
import { environment } from '../../../../core/environments/environment.prod';
// 👇 IMPORTA ApiService para los POST (logout)
import { ApiService } from '../../../../core/services/api.service';

// base del backend (Azure)
const API_BASE = environment.apiBaseUrl;

/**
 * Coincide con lo que devuelve GET /collections del backend
 */
export type CollectionRow = {
  id: number;
  name: string;
  description: string | null;
  type: 'smart' | 'static';
  filter_json: any;           // puede venir string, objeto o null
  sort_key: string | null;
  sort_dir: 'asc' | 'desc' | null;
  created_at: string;
  updated_at: string;
};

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
    return typeof exp === 'number' && Date.now()/1000 >= exp;
  } catch { return true; }
}

@Component({
  selector: 'app-collections-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './collections-list.component.html',
  styleUrls: ['./collections-list.component.scss'],
  host: { class: 'collections-page' }
})
export class CollectionsListComponent implements OnInit {
  private http   = inject(HttpClient);
  private router = inject(Router);
  private api    = inject(ApiService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // ===== Auth / UI =====
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // estado de UI
  busy        = signal<boolean>(false);
  error       = signal<string | null>(null);
  collections = signal<CollectionRow[]>([]);

  // derivado: cuántas hay de cada tipo
  smartCount = computed(() =>
    this.collections().filter(c => c.type === 'smart').length
  );
  staticCount = computed(() =>
    this.collections().filter(c => c.type === 'static').length
  );

  async ngOnInit() {
    // === auth / roles ===
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      if (!token || isExpired(token)) {
        if (token) { localStorage.clear(); sessionStorage.clear(); }
        this.isAuth = false;
        this.isAdmin = false;
        // Vista privada: redirige a login con returnUrl
        this.goLogin(this.router.url);
        return;
      }

      this.isAuth = true;
      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
    }

    await this.loadCollections();
  }

  // ===== NAV (usado por el header del template) =====
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

  // 🔁 LOGOUT ahora usando ApiService (igual que en los otros componentes)
  async logout() {
    if (!this.isBrowser) return;
    const refresh =
      localStorage.getItem('refreshToken') ??
      sessionStorage.getItem('refreshToken');

    try {
      await firstValueFrom(
        this.api.post('/auth/logout', { refreshToken: refresh })
      );
    } catch {
      // si falla igual limpiamos sesión
    }

    localStorage.clear(); sessionStorage.clear();
    this.isAuth = false; this.isAdmin = false;
    this.router.navigate(['/']);
  }

  // ===== headers protegidos =====
  private authHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  /**
   * Llama GET /collections (protegido)
   */
  async loadCollections() {
    try {
      this.busy.set(true);
      this.error.set(null);

      const rows = await firstValueFrom(
        this.http.get<CollectionRow[]>(`${API_BASE}/collections`, { headers: this.authHeaders() })
      );

      // Normalizar filter_json para que sea un objeto parseable en el front
      const normalized = (rows || []).map(row => ({
        ...row,
        filter_json: this.ensureParsedJson(row.filter_json)
      }));

      this.collections.set(normalized);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || 'No se pudieron cargar las colecciones');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * filter_json puede venir:
   *   - ya como objeto,
   *   - como string JSON,
   *   - como Buffer,
   *   - o null.
   * Lo convertimos a objeto o null.
   */
  private ensureParsedJson(raw: any): any {
    if (raw == null) return null;

    if (typeof raw === 'object' && !(typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(raw))) {
      return raw;
    }

    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    try {
      if (typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(raw)) {
        const txt = (raw as any).toString('utf8');
        return JSON.parse(txt);
      }
    } catch {
      // ignorar error
    }

    return null;
  }

  /**
   * Muestra un resumen "humano" del filtro de una colección SMART
   */
  previewFilter(c: CollectionRow): string {
    if (c.type !== 'smart') return '';
    const f: any = c.filter_json || {};
    const parts: string[] = [];

    if (f.country) parts.push(`País=${f.country}`);
    if (f.condition) parts.push(`Condición=${f.condition}`);
    if (f.yearFrom != null || f.yearTo != null) {
      parts.push(`Años ${f.yearFrom ?? '…'}-${f.yearTo ?? '…'}`);
    }
    if (Array.isArray(f.tagIds) && f.tagIds.length) {
      parts.push(`Tags ${f.tagsMode || 'OR'} [${f.tagIds.join(', ')}]`);
    }
    if (Array.isArray(f.attrs) && f.attrs.length) {
      parts.push(`Atributos(${f.attrs.length})`);
    }

    return parts.join(' · ');
  }

  /**
   * Formatea fecha tipo "2025-10-26 12:32"
   */
  fmtDate(d: string | null | undefined) {
    if (!d) return '';
    const dt = new Date(d);
    const yyyy = dt.getFullYear();
    const mm   = String(dt.getMonth() + 1).padStart(2, '0');
    const dd   = String(dt.getDate()).padStart(2, '0');
    const hh   = String(dt.getHours()).padStart(2, '0');
    const mi   = String(dt.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  /**
   * Construimos el enlace al detalle de la colección.
   */
  buildDetailLink(c: CollectionRow): any[] {
    return ['/collections', c.id];
  }

  /**
   * Llama DELETE /collections/:id (protegido)
   */
  async deleteCollection(c: CollectionRow) {
    const ok = confirm(`¿Eliminar la colección "${c.name}"? Esta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      this.busy.set(true);
      this.error.set(null);

      await firstValueFrom(
        this.http.delete(`${API_BASE}/collections/${c.id}`, { headers: this.authHeaders() })
      );

      this.collections.set(this.collections().filter(x => x.id !== c.id));
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || 'No se pudo eliminar la colección');
    } finally {
      this.busy.set(false);
    }
  }
}
