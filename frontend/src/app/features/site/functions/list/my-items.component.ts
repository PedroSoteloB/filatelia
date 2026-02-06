import {
  Component,
  inject,
  signal,
  computed,
  ViewEncapsulation,
  OnInit,
  Inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// 👈 USA LA MISMA RUTA QUE EN upload-item.component.ts
import { ApiService } from '../../../../core/services/api.service';

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
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.role ?? payload.roles ?? payload.permissions;
  } catch {
    return undefined;
  }
}

function isExpired(token: string): boolean {
  try {
    const { exp } = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return typeof exp === 'number' && Date.now() / 1000 >= exp;
  } catch {
    return true;
  }
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
  selector: 'app-my-items',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule],
  templateUrl: './my-items.component.html',
  styleUrls: ['./my-items.component.scss'],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'my-items-page' },
})
export class MyItemsComponent implements OnInit {
  private router = inject(Router);
  private api = inject(ApiService); // 👈 en vez de HttpClient directo

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // auth/ui
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // ✅ NUEVO: displayName para el header
  displayName = signal('Usuario');

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
        this.displayName.set('Usuario'); // ✅
        // como es sección privada, mándala a login con returnUrl
        this.goLogin(this.router.url);
        return;
      }

      this.isAuth = true;

      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role)
        ? role.includes('admin')
        : role === 'admin';

      // ✅ NUEVO: resolver nombre (storage -> token)
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

    // carga inicial
    this.reload();
  }

  // ===== NAV helpers =====
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

  // 🔁 Logout usando ApiService, igual que en upload-item
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
      // si falla, igual limpiamos
    }

    localStorage.clear();
    sessionStorage.clear();
    this.isAuth = false;
    this.isAdmin = false;
    this.displayName.set('Usuario'); // ✅
    this.router.navigate(['/']);
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
      params.set('order', this.order()); // 'created_at_desc' | 'created_at_asc'
      params.set('offset', String(this.offset())); // paginación simple

      const url = `${ENDPOINT}?${params.toString()}`;

      // 👇 ahora usamos ApiService (mismo baseUrl que login)
      const res = await firstValueFrom(
        this.api.get<MyItem[]>(url)
      );

      const page = Array.isArray(res) ? res : [];
      if (reset) this.items.set(page);
      else this.items.set([...this.items(), ...page]);

      this.offset.set(this.offset() + page.length);
      this.hasMore.set(page.length === this.limit);
    } catch (e: any) {
      this.error.set(
        e?.error?.message || e?.message || 'Error cargando tus ítems'
      );
      this.hasMore.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  async loadMore() { await this.fetchPage(); }

  onOrderChange(val: string) {
    const v: Order =
      val === 'created_at_asc' ? 'created_at_asc' : 'created_at_desc';
    this.order.set(v);
    this.reload();
  }

  total = computed(() => this.items().length);

  coverUrl(i: MyItem) {
    return i.cover || '';
  }

  goDashboard() {
    this.router.navigate(['/items/stats']);
  }
}
