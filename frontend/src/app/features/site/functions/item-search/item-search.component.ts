// import { Component, inject, signal, OnInit, Inject } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { Router, RouterLink } from '@angular/router';
// import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
// import { firstValueFrom } from 'rxjs';
// import { PLATFORM_ID } from '@angular/core';

// type SortDir = 'asc' | 'desc';

// type AttrFilterBetween = {
//   id?: number;
//   name?: string;
//   op: 'between';
//   from: string | number;
//   to: string | number;
// };

// type AttrFilterSingle = {
//   id?: number;
//   name?: string;
//   op?: '=' | 'like';
//   value: string | number;
// };

// type AttrFilter = AttrFilterBetween | AttrFilterSingle;

// type TagDTO = { id: number; name: string };
// type AttrDefDTO = { id: number; name: string; attrType: 'text'|'number'|'date'|'list' };

// type ItemRow = {
//   id: number;
//   title: string;
//   country?: string | null;
//   issueYear?: number | null;
//   cover?: string | null;
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
//   selector: 'app-item-search',
//   standalone: true,
//   imports: [CommonModule, RouterLink],
//   templateUrl: './item-search.component.html',
//   styleUrls: ['./item-search.component.scss']
// })
// export class ItemSearchComponent implements OnInit {
//   private http = inject(HttpClient);
//   private router = inject(Router);

//   constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

//   // ---- auth/ui
//   isAuth = false;
//   isAdmin = false;
//   isBrowser = false;

//   // ---- estado UI/negocio
//   busy = signal(false);
//   error = signal<string | null>(null);

//   // filtros básicos
//   q = signal<string>('');
//   country = signal<string>('');    // respeta el casing que espera el back (p. ej., "Peru")
//   condition = signal<string>('');  // se enviará en UPPERCASE solo si es válida
//   yearFrom = signal<number | null>(null);
//   yearTo   = signal<number | null>(null);

//   // tags
//   allTags = signal<TagDTO[]>([]);
//   selectedTagIds = signal<number[]>([]);
//   tagsMode = signal<'OR'|'AND'>('OR');

//   // atributos dinámicos
//   allAttrDefs = signal<AttrDefDTO[]>([]);
//   attrFilters = signal<AttrFilter[]>([]);

//   // resultados
//   results = signal<ItemRow[]>([]);
//   snapshotLimit = signal<number>(40);

//   // límite y whitelist de condiciones válidas (ajusta a tus enums reales)
//   readonly SEARCH_LIMIT = 20;
//   private readonly VALID_CONDITIONS = new Set(['MINT','USED','VF','F','G']);

//   // ===== lifecycle =====
//   async ngOnInit() {
//     // auth/roles
//     this.isBrowser = isPlatformBrowser(this.platformId);
//     if (this.isBrowser) {
//       const token =
//         localStorage.getItem('accessToken') ??
//         sessionStorage.getItem('accessToken') ??
//         '';

//       if (token && !isExpired(token)) {
//         this.isAuth = true;
//         const role = getRoleFromToken(token);
//         this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
//       } else {
//         if (token) { localStorage.clear(); sessionStorage.clear(); }
//         this.isAuth = false;
//         this.isAdmin = false;
//       }
//     }

//     // bootstrap de catálogos (público)
//     await Promise.all([this.loadTags(), this.loadAttrDefs()]);
//   }

//   // ===== NAV (usados por el header de esta vista) =====
//   goInicio() { this.router.navigateByUrl('/'); }

//   goLogin(returnUrl: string = this.router.url) {
//     this.router.navigate(['/login'], { queryParams: { returnUrl } });
//   }

//   // Helper: si no hay sesión, manda a login preservando destino
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

//   // ===== headers con token para endpoints protegidos =====
//   private authHeaders(): HttpHeaders {
//     if (!this.isBrowser) return new HttpHeaders();
//     const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
//     return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
//   }
//   private requireAuthOrLogin(): boolean {
//     if (!this.isAuth) {
//       this.goLogin(this.router.url);
//       return false;
//     }
//     return true;
//   }

//   // -------- bootstrap
//   async loadTags() {
//     try {
//       const tags = await firstValueFrom(this.http.get<TagDTO[]>('/tags'));
//       this.allTags.set(tags || []);
//     } catch (e: any) {
//       this.error.set(e?.message || 'No se pudieron cargar tags');
//     }
//   }

//   async loadAttrDefs() {
//     try {
//       const defs = await firstValueFrom(this.http.get<AttrDefDTO[]>('/attributes'));
//       this.allAttrDefs.set(defs || []);
//     } catch (e: any) {
//       this.error.set(e?.message || 'No se pudieron cargar atributos');
//     }
//   }

//   private normTrim(s: string) {
//     return (s ?? '').trim();
//   }

//   // -------- cambios de inputs básicos (salen del template)
//   onQChange(evt: Event) {
//     const v = (evt.target as HTMLInputElement)?.value ?? '';
//     this.q.set(v);
//   }
//   onCountryChange(evt: Event) {
//     const v = (evt.target as HTMLInputElement)?.value ?? '';
//     this.country.set(this.normTrim(v)); // sin toLowerCase(): el back puede ser case-sensitive
//   }
//   onConditionChange(evt: Event) {
//     const v = (evt.target as HTMLInputElement)?.value ?? '';
//     this.condition.set(this.normTrim(v).toUpperCase()); // enums suelen ir en mayúsculas
//   }
//   onYearFromChange(evt: Event) {
//     const raw = (evt.target as HTMLInputElement)?.value ?? '';
//     const num = raw ? Number(raw) : null;
//     this.yearFrom.set(Number.isFinite(num as number) ? (num as number) : null);
//   }
//   onYearToChange(evt: Event) {
//     const raw = (evt.target as HTMLInputElement)?.value ?? '';
//     const num = raw ? Number(raw) : null;
//     this.yearTo.set(Number.isFinite(num as number) ? (num as number) : null);
//   }

//   // -------- tags
//   setTagsMode(mode: 'OR'|'AND') { this.tagsMode.set(mode); }
//   toggleTag(id: number) {
//     const cur = new Set(this.selectedTagIds());
//     if (cur.has(id)) cur.delete(id); else cur.add(id);
//     this.selectedTagIds.set(Array.from(cur));
//   }

//   // -------- atributos dinámicos
//   onAddAttrClick(
//     attrSel: HTMLSelectElement,
//     op: string,
//     val1?: HTMLInputElement,
//     valFrom?: HTMLInputElement,
//     valTo?: HTMLInputElement
//   ) {
//     const sel = attrSel.value;
//     if (!sel) return;

//     const maybeNum = Number(sel);
//     const byId = Number.isFinite(maybeNum) ? (maybeNum as number) : undefined;

//     if (op === 'between') {
//       const fromRaw = valFrom?.value ?? '';
//       const toRaw   = valTo?.value ?? '';
//       if (!fromRaw || !toRaw) return;

//       const f = this.makeBetweenFilter(byId, fromRaw, toRaw);
//       this.attrFilters.set([...this.attrFilters(), f]);
//       return;
//     }

//     const vRaw = val1?.value ?? '';
//     if (!vRaw) return;

//     if (op === 'like') {
//       const f = this.makeLikeFilter(byId, vRaw);
//       this.attrFilters.set([...this.attrFilters(), f]);
//     } else {
//       const asNum = Number(vRaw);
//       const value: string | number = Number.isFinite(asNum) ? asNum : vRaw;
//       const f = this.makeEqualsFilter(byId, value);
//       this.attrFilters.set([...this.attrFilters(), f]);
//     }
//   }

//   private makeEqualsFilter(id: number | undefined, value: string | number): AttrFilter {
//     const named = id ? this.findAttrName(id) : undefined;
//     return { id, name: named, op: '=', value };
//   }
//   private makeLikeFilter(id: number | undefined, value: string): AttrFilter {
//     const named = id ? this.findAttrName(id) : undefined;
//     return { id, name: named, op: 'like', value };
//   }
//   private makeBetweenFilter(id: number | undefined, from: string | number, to: string | number): AttrFilter {
//     const fromNum = Number(from);
//     const toNum = Number(to);
//     const vFrom = Number.isFinite(fromNum) ? fromNum : from;
//     const vTo   = Number.isFinite(toNum) ? toNum : to;

//     const named = id ? this.findAttrName(id) : undefined;
//     return { id, name: named, op: 'between', from: vFrom, to: vTo };
//   }

//   private findAttrName(id: number): string | undefined {
//     const d = this.allAttrDefs().find(x => x.id === id);
//     return d?.name;
//   }

//   removeAttrFilter(idx: number) {
//     const arr = [...this.attrFilters()];
//     arr.splice(idx, 1);
//     this.attrFilters.set(arr);
//   }

//   clearAllFilters() {
//     this.q.set('');
//     this.country.set('');
//     this.condition.set('');
//     this.yearFrom.set(null);
//     this.yearTo.set(null);
//     this.selectedTagIds.set([]);
//     this.tagsMode.set('OR');
//     this.attrFilters.set([]);
//     this.results.set([]);
//     this.error.set(null);
//   }

//   // -------- búsqueda (pública)
//   async search() {
//     try {
//       this.busy.set(true);
//       this.error.set(null);

//       let params = new HttpParams();

//       const q         = this.normTrim(this.q());
//       const country   = this.normTrim(this.country());            // respeta casing (ej. "Peru")
//       const condition = this.normTrim(this.condition()).toUpperCase(); // aseguramos mayúsculas

//       // === Claves básicas ===
//       if (q)         params = params.set('q', q);
//       if (country)   params = params.set('country', country);
//       if (this.yearFrom() != null) params = params.set('yearFrom', String(this.yearFrom()));
//       if (this.yearTo()   != null) params = params.set('yearTo',   String(this.yearTo()));

//       // Enviar condition SOLO si es válida
//       if (condition && this.VALID_CONDITIONS.has(condition)) {
//         params = params.set('condition', condition);
//       }

//       // tagsMode y limit
//       params = params.set('tagsMode', this.tagsMode());
//       params = params.set('limit', String(this.SEARCH_LIMIT));

//       // Tags seleccionados
//       const tagIds = this.selectedTagIds();
//       if (tagIds.length) {
//         tagIds.forEach(v => params = params.append('tagIds', String(v)));
//       }

//       // Atributos dinámicos
//       if (this.attrFilters().length) {
//         params = params.set('attrs', JSON.stringify(this.attrFilters()));
//       }

//       console.debug('[search] /items/search?', params.toString());

//       const rows = await firstValueFrom(
//         this.http.get<ItemRow[]>('/items/search', { params })
//       );
//       this.results.set(rows || []);
//     } catch (e: any) {
//       this.error.set(e?.message || 'Error en búsqueda');
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   // -------- “Guardar búsqueda” (protegido)
//   async saveSearch(name: string) {
//     if (!this.requireAuthOrLogin()) return;
//     const nm = (name || '').trim();
//     if (!nm) { this.error.set('Nombre requerido para guardar búsqueda'); return; }
//     try {
//       this.busy.set(true);
//       this.error.set(null);
//       const payload = { name: nm, filter_json: this.currentFilterJson() };
//       await firstValueFrom(this.http.post('/saved-searches', payload, { headers: this.authHeaders() }));
//     } catch (e: any) {
//       this.error.set(e?.message || 'No se pudo guardar la búsqueda');
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   // -------- SMART collection (protegido)
//   onCreateSmartClick(name: string, sortKey: string, sortDir: string) {
//     const dir: SortDir = (sortDir === 'desc' ? 'desc' : 'asc');
//     this.createSmartCollection(name, sortKey, dir);
//   }

//   async createSmartCollection(name: string, sort_key: string, sort_dir: SortDir) {
//     if (!this.requireAuthOrLogin()) return;
//     const nm = (name || '').trim();
//     if (!nm) { this.error.set('Nombre requerido para SMART collection'); return; }
//     try {
//       this.busy.set(true);
//       this.error.set(null);
//       const payload = {
//         name: nm,
//         description: 'colección lógica (smart) basada en filtro',
//         type: 'smart',
//         filter_json: this.currentFilterJson(),
//         sort_key,
//         sort_dir
//       };
//       await firstValueFrom(this.http.post('/collections', payload, { headers: this.authHeaders() }));
//     } catch (e: any) {
//       this.error.set(e?.message || 'No se pudo crear la colección SMART');
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   // -------- SNAPSHOT estático (protegido)
//   onSnapshotClick(name: string, nRaw: string) {
//     const n = Number(nRaw);
//     const howMany = Number.isFinite(n) && n > 0 ? n : this.snapshotLimit();
//     this.createStaticSnapshot(name, howMany);
//   }

//   async createStaticSnapshot(name: string, howMany: number) {
//     if (!this.requireAuthOrLogin()) return;

//     const nm = (name || '').trim();
//     if (!nm) { this.error.set('Nombre requerido para SNAPSHOT'); return; }

//     try {
//       this.busy.set(true);
//       this.error.set(null);

//       const payload = {
//         name: nm,
//         description: 'snapshot estático de resultados (IDs referenciados)',
//         type: 'static',
//         filter_json: null,
//         sort_key: 'issue_year',
//         sort_dir: 'asc'
//       };
//       const created: any = await firstValueFrom(
//         this.http.post('/collections', payload, { headers: this.authHeaders() })
//       );
//       const collectionId = created?.id;
//       if (!collectionId) throw new Error('No se obtuvo id de la colección');

//       if (!this.results().length) await this.search();

//       const items = this.results().slice(0, howMany);
//       for (const it of items) {
//         await firstValueFrom(
//           this.http.post(`/collections/${collectionId}/items`, { itemId: it.id }, { headers: this.authHeaders() })
//         );
//       }
//     } catch (e: any) {
//       this.error.set(e?.message || 'No se pudo crear el snapshot estático');
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   // -------- util: serializar filtro actual
//   private currentFilterJson() {
//     const f: any = {};
//     if (this.q().trim()) f.q = this.q().trim();
//     if (this.country().trim())   f.country   = this.country().trim();
//     if (this.condition().trim()) f.condition = this.condition().trim(); // ya upper en setter
//     if (this.yearFrom() != null) f.yearFrom = this.yearFrom();
//     if (this.yearTo()   != null) f.yearTo   = this.yearTo();
//     if (this.selectedTagIds().length) {
//       f.tagIds = this.selectedTagIds();
//       f.tagsMode = String(this.tagsMode());
//     }
//     if (this.attrFilters().length) f.attrs = this.attrFilters();
//     return f;
//   }
// }
import { Component, inject, signal, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_ID } from '@angular/core';

// 👇 IMPORTA environment (ajusta la ruta IGUAL que en los otros componentes)
import { environment } from '../../../../core/environments/environment.prod';
// 👇 IMPORTA ApiService para los POST protegidos
import { ApiService } from '../../../../core/services/api.service';

// base del backend (Azure)
const API_BASE = environment.apiBaseUrl;

type SortDir = 'asc' | 'desc';

type AttrFilterBetween = {
  id?: number;
  name?: string;
  op: 'between';
  from: string | number;
  to: string | number;
};

type AttrFilterSingle = {
  id?: number;
  name?: string;
  op?: '=' | 'like';
  value: string | number;
};

type AttrFilter = AttrFilterBetween | AttrFilterSingle;

type TagDTO = { id: number; name: string };
type AttrDefDTO = { id: number; name: string; attrType: 'text'|'number'|'date'|'list' };

type ItemRow = {
  id: number;
  title: string;
  country?: string | null;
  issueYear?: number | null;
  cover?: string | null;
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
  selector: 'app-item-search',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './item-search.component.html',
  styleUrls: ['./item-search.component.scss']
})
export class ItemSearchComponent implements OnInit {
  private http   = inject(HttpClient);
  private router = inject(Router);
  private api    = inject(ApiService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // ---- auth/ui
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // ---- estado UI/negocio
  busy = signal(false);
  error = signal<string | null>(null);

  // filtros básicos
  q = signal<string>('');
  country = signal<string>('');    // respeta el casing que espera el back (p. ej., "Peru")
  condition = signal<string>('');  // se enviará en UPPERCASE solo si es válida
  yearFrom = signal<number | null>(null);
  yearTo   = signal<number | null>(null);

  // tags
  allTags = signal<TagDTO[]>([]);
  selectedTagIds = signal<number[]>([]);
  tagsMode = signal<'OR'|'AND'>('OR');

  // atributos dinámicos
  allAttrDefs = signal<AttrDefDTO[]>([]);
  attrFilters = signal<AttrFilter[]>([]);

  // resultados
  results = signal<ItemRow[]>([]);
  snapshotLimit = signal<number>(40);

  // límite y whitelist de condiciones válidas (ajusta a tus enums reales)
  readonly SEARCH_LIMIT = 20;
  private readonly VALID_CONDITIONS = new Set(['MINT','USED','VF','F','G']);

  // ===== lifecycle =====
  async ngOnInit() {
    // auth/roles
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      if (token && !isExpired(token)) {
        this.isAuth = true;
        const role = getRoleFromToken(token);
        this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
      } else {
        if (token) { localStorage.clear(); sessionStorage.clear(); }
        this.isAuth = false;
        this.isAdmin = false;
      }
    }

    // bootstrap de catálogos (público)
    await Promise.all([this.loadTags(), this.loadAttrDefs()]);
  }

  // ===== NAV (usados por el header de esta vista) =====
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

  // 🔁 LOGOUT usando ApiService
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

    localStorage.clear();
    sessionStorage.clear();
    this.isAuth = false;
    this.isAdmin = false;
    this.router.navigate(['/']);
  }

  // ===== headers con token para endpoints protegidos =====
  private authHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }
  private requireAuthOrLogin(): boolean {
    if (!this.isAuth) {
      this.goLogin(this.router.url);
      return false;
    }
    return true;
  }

  // -------- bootstrap
  async loadTags() {
    try {
      const tags = await firstValueFrom(
        this.http.get<TagDTO[]>(`${API_BASE}/tags`)
      );
      this.allTags.set(tags || []);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron cargar tags');
    }
  }

  async loadAttrDefs() {
    try {
      const defs = await firstValueFrom(
        this.http.get<AttrDefDTO[]>(`${API_BASE}/attributes`)
      );
      this.allAttrDefs.set(defs || []);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron cargar atributos');
    }
  }

  private normTrim(s: string) {
    return (s ?? '').trim();
  }

  // -------- cambios de inputs básicos
  onQChange(evt: Event) {
    const v = (evt.target as HTMLInputElement)?.value ?? '';
    this.q.set(v);
  }
  onCountryChange(evt: Event) {
    const v = (evt.target as HTMLInputElement)?.value ?? '';
    this.country.set(this.normTrim(v));
  }
  onConditionChange(evt: Event) {
    const v = (evt.target as HTMLInputElement)?.value ?? '';
    this.condition.set(this.normTrim(v).toUpperCase());
  }
  onYearFromChange(evt: Event) {
    const raw = (evt.target as HTMLInputElement)?.value ?? '';
    const num = raw ? Number(raw) : null;
    this.yearFrom.set(Number.isFinite(num as number) ? (num as number) : null);
  }
  onYearToChange(evt: Event) {
    const raw = (evt.target as HTMLInputElement)?.value ?? '';
    const num = raw ? Number(raw) : null;
    this.yearTo.set(Number.isFinite(num as number) ? (num as number) : null);
  }

  // -------- tags
  setTagsMode(mode: 'OR'|'AND') { this.tagsMode.set(mode); }
  toggleTag(id: number) {
    const cur = new Set(this.selectedTagIds());
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    this.selectedTagIds.set(Array.from(cur));
  }

  // -------- atributos dinámicos
  onAddAttrClick(
    attrSel: HTMLSelectElement,
    op: string,
    val1?: HTMLInputElement,
    valFrom?: HTMLInputElement,
    valTo?: HTMLInputElement
  ) {
    const sel = attrSel.value;
    if (!sel) return;

    const maybeNum = Number(sel);
    const byId = Number.isFinite(maybeNum) ? (maybeNum as number) : undefined;

    if (op === 'between') {
      const fromRaw = valFrom?.value ?? '';
      const toRaw   = valTo?.value ?? '';
      if (!fromRaw || !toRaw) return;

      const f = this.makeBetweenFilter(byId, fromRaw, toRaw);
      this.attrFilters.set([...this.attrFilters(), f]);
      return;
    }

    const vRaw = val1?.value ?? '';
    if (!vRaw) return;

    if (op === 'like') {
      const f = this.makeLikeFilter(byId, vRaw);
      this.attrFilters.set([...this.attrFilters(), f]);
    } else {
      const asNum = Number(vRaw);
      const value: string | number = Number.isFinite(asNum) ? asNum : vRaw;
      const f = this.makeEqualsFilter(byId, value);
      this.attrFilters.set([...this.attrFilters(), f]);
    }
  }

  private makeEqualsFilter(id: number | undefined, value: string | number): AttrFilter {
    const named = id ? this.findAttrName(id) : undefined;
    return { id, name: named, op: '=', value };
  }
  private makeLikeFilter(id: number | undefined, value: string): AttrFilter {
    const named = id ? this.findAttrName(id) : undefined;
    return { id, name: named, op: 'like', value };
  }
  private makeBetweenFilter(id: number | undefined, from: string | number, to: string | number): AttrFilter {
    const fromNum = Number(from);
    const toNum = Number(to);
    const vFrom = Number.isFinite(fromNum) ? fromNum : from;
    const vTo   = Number.isFinite(toNum) ? toNum : to;

    const named = id ? this.findAttrName(id) : undefined;
    return { id, name: named, op: 'between', from: vFrom, to: vTo };
  }

  private findAttrName(id: number): string | undefined {
    const d = this.allAttrDefs().find(x => x.id === id);
    return d?.name;
  }

  removeAttrFilter(idx: number) {
    const arr = [...this.attrFilters()];
    arr.splice(idx, 1);
    this.attrFilters.set(arr);
  }

  clearAllFilters() {
    this.q.set('');
    this.country.set('');
    this.condition.set('');
    this.yearFrom.set(null);
    this.yearTo.set(null);
    this.selectedTagIds.set([]);
    this.tagsMode.set('OR');
    this.attrFilters.set([]);
    this.results.set([]);
    this.error.set(null);
  }

  // -------- búsqueda (pública)
  async search() {
    try {
      this.busy.set(true);
      this.error.set(null);

      let params = new HttpParams();

      const q         = this.normTrim(this.q());
      const country   = this.normTrim(this.country());
      const condition = this.normTrim(this.condition()).toUpperCase();

      if (q)         params = params.set('q', q);
      if (country)   params = params.set('country', country);
      if (this.yearFrom() != null) params = params.set('yearFrom', String(this.yearFrom()));
      if (this.yearTo()   != null) params = params.set('yearTo',   String(this.yearTo()));

      if (condition && this.VALID_CONDITIONS.has(condition)) {
        params = params.set('condition', condition);
      }

      params = params.set('tagsMode', this.tagsMode());
      params = params.set('limit', String(this.SEARCH_LIMIT));

      const tagIds = this.selectedTagIds();
      if (tagIds.length) {
        tagIds.forEach(v => params = params.append('tagIds', String(v)));
      }

      if (this.attrFilters().length) {
        params = params.set('attrs', JSON.stringify(this.attrFilters()));
      }

      console.debug('[search] /items/search?', params.toString());

      const rows = await firstValueFrom(
        this.http.get<ItemRow[]>(`${API_BASE}/items/search`, { params })
      );
      this.results.set(rows || []);
    } catch (e: any) {
      this.error.set(e?.message || 'Error en búsqueda');
    } finally {
      this.busy.set(false);
    }
  }

  // -------- “Guardar búsqueda” (protegido)
  async saveSearch(name: string) {
    if (!this.requireAuthOrLogin()) return;
    const nm = (name || '').trim();
    if (!nm) { this.error.set('Nombre requerido para guardar búsqueda'); return; }
    try {
      this.busy.set(true);
      this.error.set(null);
      const payload = { name: nm, filter_json: this.currentFilterJson() };
      await firstValueFrom(
        this.api.post(
          '/saved-searches',
          payload,
          this.authHeaders()
        )
      );
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar la búsqueda');
    } finally {
      this.busy.set(false);
    }
  }

  // -------- SMART collection (protegido)
  onCreateSmartClick(name: string, sortKey: string, sortDir: string) {
    const dir: SortDir = (sortDir === 'desc' ? 'desc' : 'asc');
    this.createSmartCollection(name, sortKey, dir);
  }

  async createSmartCollection(name: string, sort_key: string, sort_dir: SortDir) {
    if (!this.requireAuthOrLogin()) return;
    const nm = (name || '').trim();
    if (!nm) { this.error.set('Nombre requerido para SMART collection'); return; }
    try {
      this.busy.set(true);
      this.error.set(null);
      const payload = {
        name: nm,
        description: 'colección lógica (smart) basada en filtro',
        type: 'smart',
        filter_json: this.currentFilterJson(),
        sort_key,
        sort_dir
      };
      await firstValueFrom(
        this.api.post(
          '/collections',
          payload,
          this.authHeaders()
        )
      );
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo crear la colección SMART');
    } finally {
      this.busy.set(false);
    }
  }

  // -------- SNAPSHOT estático (protegido)
  onSnapshotClick(name: string, nRaw: string) {
    const n = Number(nRaw);
    const howMany = Number.isFinite(n) && n > 0 ? n : this.snapshotLimit();
    this.createStaticSnapshot(name, howMany);
  }

  async createStaticSnapshot(name: string, howMany: number) {
    if (!this.requireAuthOrLogin()) return;

    const nm = (name || '').trim();
    if (!nm) { this.error.set('Nombre requerido para SNAPSHOT'); return; }

    try {
      this.busy.set(true);
      this.error.set(null);

      const payload = {
        name: nm,
        description: 'snapshot estático de resultados (IDs referenciados)',
        type: 'static',
        filter_json: null,
        sort_key: 'issue_year',
        sort_dir: 'asc'
      };

      // 1) Crear colección (via ApiService)
      const created: any = await firstValueFrom(
        this.api.post(
          '/collections',
          payload,
          this.authHeaders()
        )
      );
      const collectionId = created?.id;
      if (!collectionId) throw new Error('No se obtuvo id de la colección');

      // 2) Asegurar resultados
      if (!this.results().length) await this.search();

      // 3) Vincular items
      const items = this.results().slice(0, howMany);
      for (const it of items) {
        await firstValueFrom(
          this.api.post(
            `/collections/${collectionId}/items`,
            { itemId: it.id },
            this.authHeaders()
          )
        );
      }
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo crear el snapshot estático');
    } finally {
      this.busy.set(false);
    }
  }

  // -------- util: serializar filtro actual
  private currentFilterJson() {
    const f: any = {};
    if (this.q().trim()) f.q = this.q().trim();
    if (this.country().trim())   f.country   = this.country().trim();
    if (this.condition().trim()) f.condition = this.condition().trim();
    if (this.yearFrom() != null) f.yearFrom = this.yearFrom();
    if (this.yearTo()   != null) f.yearTo   = this.yearTo();
    if (this.selectedTagIds().length) {
      f.tagIds = this.selectedTagIds();
      f.tagsMode = String(this.tagsMode());
    }
    if (this.attrFilters().length) f.attrs = this.attrFilters();
    return f;
  }
}
