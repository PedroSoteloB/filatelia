import {
  Component,
  computed,
  effect,
  signal,
  inject,
  OnInit,
  Inject
} from '@angular/core';
import {
  CommonModule,
  isPlatformBrowser
} from '@angular/common';
import {
  ActivatedRoute,
  Router,
  RouterModule
} from '@angular/router';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpClientModule
} from '@angular/common/http';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule
} from '@angular/forms';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// 👇 environment
import { environment } from '../../../../core/environments/environment.prod';
// 👇 ApiService
import { ApiService } from '../../../../core/services/api.service';

const API_BASE = environment.apiBaseUrl;

/* =======================
   TIPOS
======================= */
type Pres = {
  id: number;
  title: string;
  description?: string | null;
  cover?: string | null;
  collection_id: number;
  created_at: string;
  updated_at: string;
  assetsCount?: number;
};

type AssetMeta = {
  caption?: string;
  edit_path?: string;
  [key: string]: any;
};

type Asset = {
  id: number;
  kind: 'video' | 'ppt' | 'image' | 'text' | 'link';
  filePath?: string | null; // /uploads/...
  url?: string | null;      // /uploads/... o https://...
  metaJson?: AssetMeta;
  createdAt: string;
};

@Component({
  selector: 'app-presentation-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    HttpClientModule
  ],
  templateUrl: './presentation-detail.component.html',
  styleUrls: ['./presentation-detail.component.scss']
})
export class PresentationDetailComponent implements OnInit {

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private router = inject(Router);
  private apiService = inject(ApiService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    effect(() => {
      const p = this.pres();
      if (p) {
        this.editForm.patchValue(
          { title: p.title, description: p.description ?? '' },
          { emitEvent: false }
        );
      }
    });
  }

  /* =======================
     STATE
  ======================= */
  isBrowser = false;

  id = signal<number | null>(null);
  loading = signal<boolean>(true);
  saving = signal<boolean>(false);
  error = signal<string | null>(null);

  pres = signal<Pres | null>(null);
  assets = signal<Asset[]>([]);
  hasCover = computed(() => !!this.pres()?.cover);

  editForm = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: ['']
  });

  newKind = signal<'image' | 'ppt' | 'video' | 'link' | 'text'>('image');
  newUrl = signal<string>('');
  newText = signal<string>('');
  newFile: File | null = null;

  /* =======================
     INIT
  ======================= */
  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);

    this.route.paramMap.subscribe((p) => {
      const pid = Number(p.get('id'));
      if (!Number.isFinite(pid)) {
        this.error.set('ID inválido');
        return;
      }
      this.id.set(pid);
      this.loadAll();
    });
  }

  /* =======================
     AUTH HEADERS
  ======================= */
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

  /* =======================
     LOAD
  ======================= */
  async loadAll() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const pid = this.id()!;

      const pres = await firstValueFrom(
        this.http.get<Pres>(`${API_BASE}/presentations/${pid}`, {
          headers: this.authHeaders()
        })
      );
      this.pres.set(pres);

      const assets = await firstValueFrom(
        this.http.get<Asset[]>(`${API_BASE}/presentations/${pid}/assets`, {
          headers: this.authHeaders()
        })
      );
      this.assets.set(assets || []);
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.loading.set(false);
    }
  }

  /* =======================
     DESCARGA – FIX CLAVE
  ======================= */

  /** ORIGIN real del API (sin /api) */
  private apiOrigin(): string {
    try {
      return new URL(API_BASE).origin;
    } catch {
      return API_BASE.replace(/\/+$/, '');
    }
  }

  /** Convierte /uploads/... en URL ABSOLUTO del API */
  private toPublicUrl(p?: string | null): string | null {
    if (!p) return null;

    if (/^https?:\/\//i.test(p)) return p;

    const idx = p.lastIndexOf('/uploads/');
    if (idx >= 0) p = p.slice(idx);

    if (p.startsWith('/uploads/')) {
      return `${this.apiOrigin()}${p}`;
    }

    return null;
  }

  /** URL FINAL para descargar */
  downloadUrl(a: Asset): string | null {
    return this.toPublicUrl(a.url) || this.toPublicUrl(a.filePath) || null;
  }

  /* =======================
     CRUD
  ======================= */
  async saveMeta() {
    if (this.editForm.invalid || !this.pres()) return;
    try {
      this.saving.set(true);
      const pid = this.pres()!.id;

      await firstValueFrom(
        this.http.put(
          `${API_BASE}/presentations/${pid}`,
          {
            title: this.editForm.value.title?.trim(),
            description: (this.editForm.value.description ?? '').trim()
          },
          { headers: this.authHeaders() }
        )
      );

      await this.reloadPresOnly();
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.saving.set(false);
    }
  }

  async onCoverChange(evt: Event) {
    const inp = evt.target as HTMLInputElement;
    const file = inp.files?.[0];
    if (!file || !this.pres()) return;

    try {
      this.saving.set(true);
      const pid = this.pres()!.id;

      const fd = new FormData();
      fd.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json' }));
      fd.append('cover', file, file.name);

      await firstValueFrom(
        this.http.put(
          `${API_BASE}/presentations/${pid}`,
          fd,
          { headers: this.authHeaders() } // NO seteamos Content-Type
        )
      );

      await this.reloadPresOnly();
    } catch (e: any) {
      this.handleError(e);
    } finally {
      (evt.target as HTMLInputElement).value = '';
      this.saving.set(false);
    }
  }

  async clearCover() {
    if (!this.pres()) return;

    try {
      this.saving.set(true);
      const pid = this.pres()!.id;

      await firstValueFrom(
        this.http.put(
          `${API_BASE}/presentations/${pid}`,
          { clearCover: true },
          { headers: this.authHeaders() }
        )
      );

      await this.reloadPresOnly();
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.saving.set(false);
    }
  }

  private async reloadPresOnly() {
    const pid = this.pres()!.id;
    const updated = await firstValueFrom(
      this.http.get<Pres>(`${API_BASE}/presentations/${pid}`, {
        headers: this.authHeaders()
      })
    );
    this.pres.set(updated);
  }

  onFileChange(ev: Event) {
    const inp = ev.target as HTMLInputElement;
    this.newFile = inp.files?.[0] ?? null;
  }

  async addAsset() {
    const pres = this.pres();
    if (!pres) return;

    try {
      this.saving.set(true);
      const kind = this.newKind();

      if (kind === 'text') {
        await firstValueFrom(
          this.apiService.post(
            `/presentations/${pres.id}/assets`,
            { kind, meta_json: { caption: this.newText().trim() } },
            this.authHeaders()
          )
        );
      } else if (kind === 'link') {
        if (!this.newUrl()) throw new Error('URL requerida');
        await firstValueFrom(
          this.apiService.post(
            `/presentations/${pres.id}/assets`,
            { kind, url: this.newUrl().trim() },
            this.authHeaders()
          )
        );
      } else {
        if (!this.newFile) throw new Error('Archivo requerido');
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('file', this.newFile, this.newFile.name);
        await firstValueFrom(
          this.apiService.post(
            `/presentations/${pres.id}/assets`,
            fd,
            this.authHeaders()
          )
        );
      }

      this.newUrl.set('');
      this.newText.set('');
      this.newFile = null;

      const assets = await firstValueFrom(
        this.http.get<Asset[]>(`${API_BASE}/presentations/${pres.id}/assets`, {
          headers: this.authHeaders()
        })
      );
      this.assets.set(assets || []);
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteAsset(a: Asset) {
    const pres = this.pres();
    if (!pres || !confirm('¿Eliminar este recurso?')) return;

    try {
      this.saving.set(true);
      await firstValueFrom(
        this.http.delete(
          `${API_BASE}/presentations/${pres.id}/assets/${a.id}`,
          { headers: this.authHeaders() }
        )
      );
      this.assets.set(this.assets().filter(x => x.id !== a.id));
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.saving.set(false);
    }
  }

  /* =======================
     UI HELPERS
  ======================= */
  kindIcon(a: Asset) {
    return a.kind === 'image' ? '🖼️'
      : a.kind === 'video' ? '🎬'
      : a.kind === 'ppt'   ? '📑'
      : a.kind === 'link'  ? '🔗'
      : '📝';
  }

  isMedia(a: Asset) {
    return a.kind === 'image' || a.kind === 'video';
  }

  back() {
    this.router.navigate(['/presentations']);
  }

  private handleError(e: any) {
    const msg =
      (e as HttpErrorResponse)?.error?.message ||
      (e as Error)?.message ||
      'error';
    this.error.set(msg);
    console.error(e);
  }
}
