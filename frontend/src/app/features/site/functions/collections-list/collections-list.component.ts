import { Component, inject, signal, computed, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_ID } from '@angular/core';

import { environment } from '../../../../core/environments/environment.prod';
import { ApiService } from '../../../../core/services/api.service';

const API_BASE = environment.apiBaseUrl;

export type CollectionRow = {
  id: number;
  name: string;
  description: string | null;
  type: 'smart' | 'static';
  filter_json: any;
  sort_key: string | null;
  sort_dir: 'asc' | 'desc' | null;
  created_at: string;
  updated_at: string;
  parent_collection_id?: number | null;
  cover_image_path?: string | null;

  thumb?: string | null;
  thumbs?: string[];

  // ✅ NUEVO (lo que ahora devuelve el backend)
  filter_tag_ids?: number[];
  filter_tags?: string[];
  filter_tag_mode?: string | null;
  filter_attrs?: any[];
  filter_chips?: string[];
};

// ==== Helpers JWT (roles y expiración) ====
function getRoleFromToken(token: string): any {
  if (!token) return undefined;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.role ?? payload.roles ?? payload.permissions;
  } catch { return undefined; }
}
function isExpired(token: string): boolean {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof exp === 'number' && Date.now() / 1000 >= exp;
  } catch { return true; }
}

// ✅ NUEVO: decode payload para name/email
function decodeTokenPayload(token: string): any {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
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
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = inject(ApiService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // ===== Auth / UI =====
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // ✅ NUEVO: displayName para el header
  displayName = signal('Usuario');

  // estado de UI
  busy = signal<boolean>(false);
  error = signal<string | null>(null);
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
        this.displayName.set('Usuario'); // ✅
        this.goLogin(this.router.url);
        return;
      }

      this.isAuth = true;
      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';

      // ✅ NUEVO: nombre (storage -> token)
      const name =
        localStorage.getItem('displayName') ??
        sessionStorage.getItem('displayName');

      if (name) {
        this.displayName.set(name);
      } else {
        const p = decodeTokenPayload(token);
        this.displayName.set(p?.name ?? p?.email ?? 'Usuario');
      }
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

  // 🔁 LOGOUT ahora usando ApiService
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
    this.displayName.set('Usuario'); // ✅
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
        this.http.get<CollectionRow[]>(
          `${API_BASE}/collections`,
          { headers: this.authHeaders() }
        )
      );

      const normalized = (rows || []).map((row: any) => {
        // ✅ 1) normalizar filter_json (soporta doble stringify)
        const parsedFilter = this.ensureParsedJson(row.filter_json);

        // ✅ 2) normalizar miniatura (snake_case o camelCase)
        const raw = (row.cover_image_path ?? row.coverImagePath ?? null) as string | null;
        const rel = raw && raw.trim().length ? raw.trim() : null;

        // ✅ 3) construir URL absoluta SOLO si es relativa
        const abs = rel
          ? (rel.startsWith('http')
              ? rel
              : `${API_BASE}${rel.startsWith('/') ? '' : '/'}${rel}`)
          : null;

        // ✅ 4) construir chips para SMART y STATIC
        const chips = this.filterChipsFromFilter(parsedFilter);

        return {
          ...row,
          filter_json: parsedFilter,
          filter_chips: chips,
          thumb: abs
        } as CollectionRow;
      });

      this.collections.set(normalized);

    } catch (e: any) {
      this.error.set(
        e?.error?.message ||
        e?.message ||
        'No se pudieron cargar las colecciones'
      );
    } finally {
      this.busy.set(false);
    }
  }

  private ensureParsedJson(raw: any): any {
    if (raw == null) return null;

    const isBuf = typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(raw);

    // si ya es objeto (y no Buffer) -> ok
    if (typeof raw === 'object' && !isBuf) return raw;

    // convertir a string
    let txt: string | null = null;

    if (isBuf) {
      try { txt = raw.toString('utf8'); } catch { txt = null; }
    } else if (typeof raw === 'string') {
      txt = raw;
    }

    if (!txt) return null;

    // 1er parse
    try {
      const once = JSON.parse(txt);

      // si el resultado sigue siendo string, era doble stringify
      if (typeof once === 'string') {
        try {
          return JSON.parse(once);
        } catch {
          return null;
        }
      }

      return once;
    } catch {
      return null;
    }
  }

  /**
   * Chips desde el filtro PARSEADO (sirve para SMART y STATIC)
   */
  private filterChipsFromFilter(f: any): string[] {
    if (!f || typeof f !== 'object') return [];

    const chips: string[] = [];

    if (f.q) {
      const s = String(f.q);
      chips.push(`Texto: ${s.slice(0, 24)}${s.length > 24 ? '…' : ''}`);
    }

    if (f.country) chips.push(`País: ${f.country}`);
    if (f.condition) chips.push(`Condición: ${f.condition}`);

    if (f.yearFrom != null || f.yearTo != null) {
      chips.push(`Año: ${f.yearFrom ?? '—'}–${f.yearTo ?? '—'}`);
    }

    if (Array.isArray(f.tagIds) && f.tagIds.length) {
      const mode = f.tagsMode || 'OR';
      const head = f.tagIds.slice(0, 3).join(', ');
      chips.push(`Tags ${mode}: ${head}${f.tagIds.length > 3 ? '…' : ''}`);
    }

    if (Array.isArray(f.attrs) && f.attrs.length) {
      chips.push(`Atributos: ${f.attrs.length}`);
    }

    return chips.slice(0, 8);
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
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

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

  // ===== thumbs =====
  onThumbError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (img) img.style.display = 'none';
  }

  getMainThumb(c: any): string | null {
    return c?.thumb || (Array.isArray(c?.thumbs) && c.thumbs.length ? c.thumbs[0] : null);
  }

  setMainThumb(c: any, url: string) {
    if (!c) return;
    c.thumb = url; // solo UI
  }

  trackByThumb = (_: number, url: string) => url;

  onThumbMiniError(c: any, badUrl: string) {
    if (!c?.thumbs) return;
    c.thumbs = (c.thumbs || []).filter((x: string) => x !== badUrl);
    if (c.thumb === badUrl) c.thumb = this.getMainThumb(c);
  }

  // (dejo tus helpers por si los usas en otros lados)
  private formatChip(x: any): string {
    const key = x?.field || x?.key || x?.name;
    const val = x?.value ?? x?.values ?? x?.val;

    if (!key) return '';
    if (Array.isArray(val)) return `${this.prettyKey(key)}: ${val.slice(0, 2).join(', ')}${val.length > 2 ? '…' : ''}`;
    if (val === null || val === undefined || val === '') return `${this.prettyKey(key)}`;
    return `${this.prettyKey(key)}: ${String(val)}`;
  }

  private prettyKey(k: string): string {
    return String(k)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, m => m.toUpperCase());
  }

  goDashboard() {
    this.router.navigate(['/items/stats']);
  }
}
