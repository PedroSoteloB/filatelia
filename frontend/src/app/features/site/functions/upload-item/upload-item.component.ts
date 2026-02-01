import {
  Component,
  signal,
  computed,
  inject,
  ViewEncapsulation,
  OnInit,
  Inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpHeaders, HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_ID } from '@angular/core';
import { ApiService } from '../../../../core/services/api.service';

const ENDPOINT_ITEMS = '/items';

// Tipos para atributos dinámicos (UI)
type AttrType = 'text' | 'number' | 'date' | 'list';
interface DynAttr {
  name: string;
  type: AttrType;
  value: string;
}

// Payload que espera el backend en meta.categories
type CategoryPayload =
  | { name: string; attrType: 'number'; value: number }
  | { name: string; attrType: 'date'; value: string }   // YYYY-MM-DD
  | { name: string; attrType: 'text' | 'list'; value: string };

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

@Component({
  selector: 'app-upload-item',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './upload-item.component.html',
  styleUrls: ['./upload-item.component.scss'],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'upload-item-page' },
})
export class UploadItemComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private api: ApiService
  ) {}

  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  maxImages = 12;
  maxFileMB = 10;
  allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  files = signal<File[]>([]);
  busy = signal(false);
  error = signal<string | null>(null);
  successId = signal<number | null>(null);

  // === TAGS (chips) ===
  tags = signal<string[]>([]);
  tagDraft = signal('');

  // === ATRIBUTOS DINÁMICOS (drafts + lista) ===
  attrNameDraft = signal('');
  attrTypeDraft = signal<AttrType>('text');
  attrValueDraft = signal('');
  attrs = signal<DynAttr[]>([]);

  form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: [''],
    country: [''],
    issueYear: [null as number | null],
    condition: [''],
    catalogCode: [''],
    faceValue: [null as number | null],
    currency: [''],
    acquisitionDate: [''],
    visibility: ['public', Validators.required], // el backend igual lo fija a 'public'
    tagsCsv: ['']
  });

  ngOnInit(): void {
    this.form.get('visibility')?.disable({ emitEvent: false, onlySelf: true });

    // === detectar navegador y evaluar auth/roles ===
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
        this.goLogin(this.router.url);
        return;
      }

      this.isAuth = true;
      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role)
        ? role.includes('admin')
        : role === 'admin';
    }
  }

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

  // 🔁 LOGOUT usando ApiService (no más fetch al frontend)
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

  // ===== Helpers =====
  private normalizeTag(s: string) { return s.trim().replace(/\s+/g, ' '); }

  private pushTags(raws: string[]) {
    const base = new Set(this.tags());
    for (const r of raws) {
      const t = this.normalizeTag(r);
      if (t) base.add(t);
    }
    this.tags.set([...base].slice(0, 50));
  }

  // private buildCategories(): CategoryPayload[] {
  //   // 🔍 log de lo que hay en attrs antes de mapear
  //   console.log('[UPLOAD] buildCategories() raw attrs =', this.attrs());

  //   const out: (CategoryPayload | null)[] = this.attrs().map(a => {
  //     const name = a.name?.trim();
  //     if (!name) return null;

  //     if (a.type === 'number') {
  //       const n = Number(String(a.value).replace(',', '.').trim());
  //       if (!Number.isFinite(n)) return null;
  //       return { name, attrType: 'number', value: n } as const;
  //     }

  //     if (a.type === 'date') {
  //       const v = String(a.value || '').trim();
  //       if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  //       return { name, attrType: 'date', value: v } as const;
  //     }

  //     const v = String(a.value || '').trim();
  //     if (!v) return null;
  //     return { name, attrType: a.type, value: v } as const;
  //   });

  //   const filtered = out.filter((x): x is CategoryPayload => !!x);

  //   console.log('[UPLOAD] buildCategories() filtered =', filtered);
  //   return filtered;
  // }
  private buildCategories(): CategoryPayload[] {
    const seen = new Set<string>();
  
    const out: CategoryPayload[] = [];
  
    for (const a of this.attrs()) {
      const prettyName = this.toTitleCase(a.name);
      const key = this.normalizeKey(prettyName);
      if (!key) continue;
  
      // ✅ dedupe final antes de enviar
      if (seen.has(key)) continue;
      seen.add(key);
  
      if (a.type === 'number') {
        const n = Number(String(a.value).replace(',', '.').trim());
        if (!Number.isFinite(n)) continue;
        out.push({ name: prettyName, attrType: 'number', value: n });
        continue;
      }
  
      if (a.type === 'date') {
        const v = String(a.value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
        out.push({ name: prettyName, attrType: 'date', value: v });
        continue;
      }
  
      const v = String(a.value || '').trim();
      if (!v) continue;
      out.push({ name: prettyName, attrType: a.type, value: v });
    }
  
    return out;
  }
  

  remaining = computed(() => this.maxImages - this.files().length);

  // ======= Files =======
  onFilePick(e: Event) {
    const input = e.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    const current = this.files();
    const next: File[] = [];
    const errors: string[] = [];

    for (const f of picked) {
      if (!this.allowedTypes.has(f.type)) {
        errors.push(`Formato no soportado: ${f.name}`); continue;
      }
      if (f.size > this.maxFileMB * 1024 * 1024) {
        errors.push(`Archivo > ${this.maxFileMB}MB: ${f.name}`); continue;
      }
      if (current.length + next.length >= this.maxImages) break;
      next.push(f);
    }

    this.files.set([...current, ...next]);
    if (errors.length) this.error.set(errors.join(' | '));
    input.value = '';
  }

  removeFile(i: number) {
    const arr = [...this.files()];
    arr.splice(i, 1);
    this.files.set(arr);
  }

  // ======= Tags =======
  addTagFromDraft() {
    const raw = this.tagDraft();
    if (!raw.trim()) return;
    this.pushTags(raw.split(','));
    this.tagDraft.set('');
  }

  onTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this.addTagFromDraft();
    }
  }

  onTagInput(ev: Event) {
    const val = (ev.target as HTMLInputElement | null)?.value ?? '';
    this.tagDraft.set(val);
  }

  removeTag(i: number) {
    const arr = [...this.tags()];
    arr.splice(i, 1);
    this.tags.set(arr);
  }

  // ======= Attrs UI handlers =======
  onAttrNameInput(ev: Event) {
    const v = (ev.target as HTMLInputElement).value ?? '';
    this.attrNameDraft.set(v);
  }

  onAttrTypeChange(ev: Event) {
    const v = (ev.target as HTMLSelectElement).value as AttrType;
    this.attrTypeDraft.set(v);
  }

  onAttrValueInput(ev: Event) {
    const v = (ev.target as HTMLInputElement).value ?? '';
    this.attrValueDraft.set(v);
  }

  // addAttr() {
  //   const name = this.attrNameDraft().trim();
  //   if (!name) return;
  //   const entry: DynAttr = {
  //     name,
  //     type: this.attrTypeDraft(),
  //     value: this.attrValueDraft().trim(),
  //   };
  //   this.attrs.set([...this.attrs(), entry]);
  //   this.attrNameDraft.set('');
  //   this.attrValueDraft.set('');
  //   this.attrTypeDraft.set('text');

  //   console.log('[UPLOAD] addAttr() attrs =', this.attrs());
  // }
  addAttr() {
    this.error.set(null);
  
    const raw = this.attrNameDraft();
    const prettyName = this.toTitleCase(raw);
    const key = this.normalizeKey(prettyName);
  
    if (!key) return;
  
    // 🚫 bloquea duplicados WAS/was/WaS (case-insensitive + espacios)
    const exists = this.attrs().some(a => this.normalizeKey(a.name) === key);
    if (exists) {
      this.error.set(`Ya existe un atributo con el nombre "${prettyName}".`);
      return;
    }
  
    const entry: DynAttr = {
      name: prettyName,                 // guardas estandarizado
      type: this.attrTypeDraft(),
      value: this.attrValueDraft().trim(),
    };
  
    this.attrs.set([...this.attrs(), entry]);
  
    // reset drafts
    this.attrNameDraft.set('');
    this.attrValueDraft.set('');
    this.attrTypeDraft.set('text');
  
    console.log('[UPLOAD] addAttr() attrs =', this.attrs());
  }
  

  removeAttr(index: number) {
    const arr = [...this.attrs()];
    arr.splice(index, 1);
    this.attrs.set(arr);
    console.log('[UPLOAD] removeAttr() attrs =', this.attrs());
  }

  // ======= Submit =======
  // async submit() {
  //   this.error.set(null);
  //   this.successId.set(null);

  //   if (this.form.invalid) {
  //     this.form.markAllAsTouched();
  //     this.error.set('Completa los campos obligatorios.');
  //     return;
  //   }
  //   if (this.files().length === 0) {
  //     this.error.set('Sube al menos una imagen.');
  //     return;
  //   }

  //   const csv = (this.form.get('tagsCsv')?.value || '') as string;
  //   if (csv.trim()) this.pushTags(csv.split(','));

  //   const v = this.form.getRawValue();
  //   const tags = this.tags();
  //   const categories = this.buildCategories();

  //   // 🔍 LOGS CLAVE ANTES DE ENVIAR
  //   console.log('[UPLOAD] attrs UI (antes de enviar) =', this.attrs());
  //   console.log('[UPLOAD] categories payload =', categories);
  //   console.log('[UPLOAD] tags =', tags);

  //   const metadata: any = {
  //     title: v.title?.trim(),
  //     description: v.description || null,
  //     country: v.country || null,
  //     issueYear: v.issueYear ?? null,
  //     condition: v.condition || null,
  //     catalogCode: v.catalogCode || null,
  //     faceValue: v.faceValue ?? null,
  //     currency: v.currency || null,
  //     acquisitionDate: v.acquisitionDate || null,
  //     visibility: 'public',
  //     tags,
  //     categories
  //   };

  //   console.log('[UPLOAD] metadata enviado =', metadata);

  //   const fd = new FormData();
  //   fd.append('metadata', JSON.stringify(metadata));
  //   this.files().forEach((file, idx) =>
  //     fd.append(`image${idx + 1}`, file, file.name)
  //   );

  //   console.log('[UPLOAD] FormData metadata =', fd.get('metadata'));

  //   const token =
  //     (this.isBrowser &&
  //       (localStorage.getItem('accessToken') ||
  //         sessionStorage.getItem('accessToken'))) ||
  //     '';

  //   const headers = new HttpHeaders(
  //     token ? { Authorization: `Bearer ${token}` } : {}
  //   );

  //   this.busy.set(true);
  //   try {
  //     console.log('[UPLOAD] Enviando POST', ENDPOINT_ITEMS);
  //     const res = await firstValueFrom(
  //       this.api.post<{ id: number }>(ENDPOINT_ITEMS, fd, headers)
  //     );
  //     console.log('[UPLOAD] Respuesta /items =', res);

  //     this.successId.set(res?.id ?? null);

  //     this.files.set([]);
  //     this.tags.set([]);
  //     this.tagDraft.set('');
  //     this.attrs.set([]);
  //     this.attrNameDraft.set('');
  //     this.attrValueDraft.set('');
  //     this.attrTypeDraft.set('text');

  //     this.form.reset({ visibility: 'public', tagsCsv: '' });
  //     this.form.get('visibility')?.disable({ emitEvent: false, onlySelf: true });
  //   } catch (e: any) {
  //     console.error('[UPLOAD] ERROR /items =', e);
  //     this.error.set(
  //       e?.error?.message || e?.message || 'Error subiendo la pieza'
  //     );
  //   } finally {
  //     this.busy.set(false);
  //   }
  // }
  async submit() {
    this.error.set(null);
    this.successId.set(null);
  
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Completa los campos obligatorios.');
      return;
    }
    if (this.files().length === 0) {
      this.error.set('Sube al menos una imagen.');
      return;
    }
  
    const csv = (this.form.get('tagsCsv')?.value || '') as string;
    if (csv.trim()) this.pushTags(csv.split(','));
  
    const v = this.form.getRawValue();
    const tags = this.tags();
    const categories = this.buildCategories();
  
    // 🔍 LOGS CLAVE ANTES DE ENVIAR
    console.log('[UPLOAD] attrs UI (antes de enviar) =', this.attrs());
    console.log('[UPLOAD] categories payload =', categories);
    console.log('[UPLOAD] tags =', tags);
  
    const metadata: any = {
      title: v.title?.trim(),
      description: v.description || null,
      country: v.country || null,
      issueYear: v.issueYear ?? null,
      condition: v.condition || null,
      catalogCode: v.catalogCode || null,
      faceValue: v.faceValue ?? null,
      currency: v.currency || null,
      acquisitionDate: v.acquisitionDate || null,
      visibility: 'public',
      tags,
      categories
    };
  
    console.log('[UPLOAD] metadata enviado =', metadata);
  
    const fd = new FormData();
    fd.append('metadata', JSON.stringify(metadata));
    this.files().forEach((file, idx) =>
      fd.append(`image${idx + 1}`, file, file.name)
    );
  
    console.log('[UPLOAD] FormData metadata =', fd.get('metadata'));
  
    const token =
      (this.isBrowser &&
        (localStorage.getItem('accessToken') ||
          sessionStorage.getItem('accessToken'))) ||
      '';
  
    const headers = new HttpHeaders(
      token ? { Authorization: `Bearer ${token}` } : {}
    );
  
    // 🔄 activa loading (spinner en el botón)
    this.busy.set(true);
  
    try {
      console.log('[UPLOAD] Enviando POST', ENDPOINT_ITEMS);
  
      const res = await firstValueFrom(
        this.api.post<{ id: number }>(ENDPOINT_ITEMS, fd, headers)
      );
  
      console.log('[UPLOAD] Respuesta /items =', res);
  
      // ✅ marca éxito (esto activa el mensaje en el HTML)
      const id = res?.id ?? null;
      this.successId.set(id);
  
      // (opcional) resetea formulario/listas para que quede limpio
      this.files.set([]);
      this.tags.set([]);
      this.tagDraft.set('');
      this.attrs.set([]);
      this.attrNameDraft.set('');
      this.attrValueDraft.set('');
      this.attrTypeDraft.set('text');
  
      this.form.reset({ visibility: 'public', tagsCsv: '' });
      this.form.get('visibility')?.disable({ emitEvent: false, onlySelf: true });
  
      // ➡️ redirige a "Mis ítems" luego de mostrar el OK un ratito
      setTimeout(() => {
        this.router.navigate(['/items/mine']);
      }, 1200);
  
    } catch (e: any) {
      console.error('[UPLOAD] ERROR /items =', e);
      this.error.set(
        e?.error?.message || e?.message || 'Error subiendo la pieza'
      );
    } finally {
      // 🔚 apaga loading (si ya redirigió, igual no molesta)
      this.busy.set(false);
    }
  }
  

  // ======= Normalización y validación (Attrs) =======

// Para comparar: trim + colapsa espacios + lower
private normalizeKey(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Para mostrar: Title Case (bonito)
private toTitleCase(s: string): string {
  return (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

attrNameError(): string {
  const raw = this.attrNameDraft();
  const prettyName = this.toTitleCase(raw);
  const key = this.normalizeKey(prettyName);

  if (!raw || !raw.trim()) return 'Ingresa un nombre de atributo.';

  const exists = this.attrs().some(a => this.normalizeKey(a.name) === key);
  if (exists) return `Ya existe un atributo con el nombre "${prettyName}".`;

  return '';
}

normalizeAttrNameDraft(): void {
  const raw = this.attrNameDraft();
  const prettyName = this.toTitleCase(raw);

  // Si quieres que al salir del input se “auto-formatee”
  if (prettyName !== raw) {
    this.attrNameDraft.set(prettyName);
  }
}

isAttrNameDuplicate(): boolean {
  const raw = this.attrNameDraft();
  const prettyName = this.toTitleCase(raw);
  const key = this.normalizeKey(prettyName);

  if (!key) return false;

  return this.attrs().some(a => this.normalizeKey(a.name) === key);
}



}
