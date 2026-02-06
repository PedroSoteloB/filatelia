import {
  Component,
  OnInit,
  signal,
  inject,
  Inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
  FormControl
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClientModule, HttpClient, HttpHeaders } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// ⭐ Usa el ApiService centralizado (para POST)
import { ApiService } from '../../../../core/services/api.service';
// ⭐ Traemos environment SOLO para armar la URL del GET
import { environment } from '../../../../core/environments/environment.prod';

const API_BASE = environment.apiBaseUrl;

type Pres = {
  id: number;
  title: string;
  description?: string | null;
  cover?: string | null;
  collection_id: number;
  created_at: string;
  updated_at: string;
};

// === Helpers JWT (roles/exp) ===
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

// ✅ Si no hay `exp`, lo consideramos **no vencido**
function isExpired(token: string): boolean {
  try {
    const { exp } = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    if (typeof exp !== 'number') return false;
    return Date.now() / 1000 >= exp;
  } catch {
    return false;
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
  selector: 'app-presentations-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule, RouterLink],
  templateUrl: './presentations-home.component.html',
  styleUrls: ['./presentations-home.component.scss'],
})
export class PresentationsHomeComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private api = inject(ApiService);
  private http = inject(HttpClient);   // 👈 para el GET con headers

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // Auth/UI
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  // ✅ NUEVO: para "Hola, {{ displayName() }}"
  displayName = signal('Usuario');

  loading = signal<boolean>(false);
  error = signal<string | null>(null);
  items = signal<Pres[]>([]);

  offset = 0;
  limit = 20;
  hasMore = signal<boolean>(false);
  showCreate = signal<boolean>(false);

  // ✅ Form tipado
  createForm: FormGroup<{
    collection_id: FormControl<number | null>;
    title: FormControl<string>;
    description: FormControl<string | null>;
    cover: FormControl<File | null>;
  }> = this.fb.group({
    collection_id: this.fb.control<number | null>(null, {
      validators: [Validators.required],
    }),
    title: this.fb.control<string>('', {
      validators: [Validators.required, Validators.maxLength(180)],
      nonNullable: true,
    }),
    description: this.fb.control<string | null>(null),
    cover: this.fb.control<File | null>(null),
  });

  get fc() {
    return this.createForm.controls;
  }

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      if (token && !isExpired(token)) {
        this.isAuth = true;
        const role = getRoleFromToken(token);
        this.isAdmin = Array.isArray(role)
          ? role.includes('admin')
          : role === 'admin';

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
      } else {
        if (token && isExpired(token)) {
          localStorage.clear();
          sessionStorage.clear();
        }
        this.isAuth = false;
        this.isAdmin = false;
        this.displayName.set('Usuario'); // ✅
      }
    }

    this.load();
  }

  // ===== NAV =====
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

  // 🔁 LOGOUT usando ApiService (igual que en UploadItem)
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
    this.displayName.set('Usuario'); // ✅
    this.router.navigate(['/']);
  }

  private authHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();
    const token =
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('accessToken') ||
      '';
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  load(direction: 'init' | 'next' | 'prev' = 'init') {
    if (direction === 'next') this.offset += this.limit;
    if (direction === 'prev')
      this.offset = Math.max(0, this.offset - this.limit);

    this.loading.set(true);
    this.error.set(null);

    // 👉 ahora armamos la URL completa y usamos HttpClient directo
    const url = `${API_BASE}/presentations?offset=${this.offset}&limit=${this.limit}`;

    this.http.get<Pres[]>(url, { headers: this.authHeaders() }).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.hasMore.set(rows.length === this.limit);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Http error');
        this.loading.set(false);
      },
    });
  }

  toggleCreate() {
    this.showCreate.set(!this.showCreate());
  }

  onCoverChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.fc.cover.setValue(file);
  }

  submitCreate() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    const { collection_id, title, description, cover } =
      this.createForm.getRawValue();

    let body: any;
    let headers: HttpHeaders;

    if (cover instanceof File) {
      const fd = new FormData();
      fd.append('metadata', JSON.stringify({ collection_id, title, description }));
      fd.append('cover', cover);
      body = fd;
      headers = this.authHeaders(); // el browser setea el boundary
    } else {
      body = { collection_id, title, description };
      headers = this.authHeaders().set('Content-Type', 'application/json');
    }

    this.loading.set(true);

    // ⭐ POST usando ApiService (sin concatenar API_BASE)
    this.api.post<{ id: number }>('/presentations', body, headers).subscribe({
      next: () => {
        this.loading.set(false);
        this.showCreate.set(false);
        this.createForm.reset();
        this.offset = 0;
        this.load('init');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err?.error?.message || 'No se pudo crear la presentación'
        );
      },
    });
  }

  trackById = (_: number, it: Pres) => it.id;

  goDashboard() {
    this.router.navigate(['/items/stats']);
  }
}
