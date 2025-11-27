// import { Component, signal, computed, inject, ViewEncapsulation, OnInit } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
// import { HttpClient, HttpHeaders, HttpClientModule } from '@angular/common/http';
// import { Router } from '@angular/router';
// import { firstValueFrom } from 'rxjs';

// const ENDPOINT_ITEMS = '/items';

// // Tipos para atributos dinámicos (UI)
// type AttrType = 'text' | 'number' | 'date' | 'list';
// interface DynAttr {
//   name: string;
//   type: AttrType;
//   value: string;
// }

// // Payload que espera el backend en meta.categories
// type CategoryPayload =
//   | { name: string; attrType: 'number'; value: number }
//   | { name: string; attrType: 'date'; value: string }   // YYYY-MM-DD
//   | { name: string; attrType: 'text' | 'list'; value: string };

// @Component({
//   selector: 'app-upload-item',
//   standalone: true,
//   imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
//   templateUrl: './upload-item.component.html',
//   styleUrls: ['./upload-item.component.scss'],
//   encapsulation: ViewEncapsulation.None,
//   host: { class: 'upload-item-page' },
// })
// export class UploadItemComponent implements OnInit {
//   private fb = inject(FormBuilder);
//   private http = inject(HttpClient);
//   private router = inject(Router);

//   isAuth = false;
//   isAdmin = false;
//   isBrowser = false;

//   maxImages = 12;
//   maxFileMB = 10;
//   allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

//   files = signal<File[]>([]);
//   busy = signal(false);
//   error = signal<string | null>(null);
//   successId = signal<number | null>(null);

//   // === TAGS (chips) ===
//   tags = signal<string[]>([]);
//   tagDraft = signal('');

//   // === ATRIBUTOS DINÁMICOS (drafts + lista) ===
//   attrNameDraft = signal('');
//   attrTypeDraft = signal<AttrType>('text');
//   attrValueDraft = signal('');
//   attrs = signal<DynAttr[]>([]);

//   form = this.fb.group({
//     title: ['', [Validators.required, Validators.maxLength(200)]],
//     description: [''],
//     country: [''],
//     issueYear: [null as number | null],
//     condition: [''],
//     catalogCode: [''],
//     faceValue: [null as number | null],
//     currency: [''],
//     acquisitionDate: [''],
//     visibility: ['public', Validators.required], // el backend igual lo fija a 'public'
//     tagsCsv: ['']
//   });

//   ngOnInit(): void {
//     this.form.get('visibility')?.disable({ emitEvent: false, onlySelf: true });
//   }
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

//   // ===== Helpers =====
//   private normalizeTag(s: string) { return s.trim().replace(/\s+/g, ' '); }
//   private pushTags(raws: string[]) {
//     const base = new Set(this.tags());
//     for (const r of raws) {
//       const t = this.normalizeTag(r);
//       if (t) base.add(t);
//     }
//     this.tags.set([...base].slice(0, 50));
//   }

//   // Convierte los attrs de UI a `categories` que consume /items
//   private buildCategories(): CategoryPayload[] {
//     const out: (CategoryPayload | null)[] = this.attrs().map(a => {
//       const name = a.name?.trim();
//       if (!name) return null;

//       if (a.type === 'number') {
//         const n = Number(String(a.value).replace(',', '.').trim());
//         if (!Number.isFinite(n)) return null;
//         return { name, attrType: 'number', value: n } as const;
//       }

//       if (a.type === 'date') {
//         const v = String(a.value || '').trim();
//         if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; // YYYY-MM-DD
//         return { name, attrType: 'date', value: v } as const;
//       }

//       // text / list
//       const v = String(a.value || '').trim();
//       if (!v) return null;
//       return { name, attrType: a.type, value: v } as const;
//     });

//     return out.filter((x): x is CategoryPayload => !!x);
//   }

//   remaining = computed(() => this.maxImages - this.files().length);

//   // ======= Files =======
//   onFilePick(e: Event) {
//     const input = e.target as HTMLInputElement;
//     const picked = Array.from(input.files || []);
//     const current = this.files();
//     const next: File[] = [];
//     const errors: string[] = [];

//     for (const f of picked) {
//       if (!this.allowedTypes.has(f.type)) { errors.push(`Formato no soportado: ${f.name}`); continue; }
//       if (f.size > this.maxFileMB * 1024 * 1024) { errors.push(`Archivo > ${this.maxFileMB}MB: ${f.name}`); continue; }
//       if (current.length + next.length >= this.maxImages) break;
//       next.push(f);
//     }

//     this.files.set([...current, ...next]);
//     if (errors.length) this.error.set(errors.join(' | '));
//     input.value = '';
//   }

//   removeFile(i: number) {
//     const arr = [...this.files()];
//     arr.splice(i, 1);
//     this.files.set(arr);
//   }

//   // ======= Tags =======
//   addTagFromDraft() {
//     const raw = this.tagDraft();
//     if (!raw.trim()) return;
//     this.pushTags(raw.split(','));
//     this.tagDraft.set('');
//   }
//   onTagKeydown(e: KeyboardEvent) {
//     if (e.key === 'Enter' || e.key === ',') {
//       e.preventDefault();
//       this.addTagFromDraft();
//     }
//   }
//   onTagInput(ev: Event) {
//     const val = (ev.target as HTMLInputElement | null)?.value ?? '';
//     this.tagDraft.set(val);
//   }
//   removeTag(i: number) {
//     const arr = [...this.tags()];
//     arr.splice(i, 1);
//     this.tags.set(arr);
//   }

//   // ======= Attrs UI handlers =======
//   onAttrNameInput(ev: Event) {
//     const v = (ev.target as HTMLInputElement).value ?? '';
//     this.attrNameDraft.set(v);
//   }
//   onAttrTypeChange(ev: Event) {
//     const v = (ev.target as HTMLSelectElement).value as AttrType;
//     this.attrTypeDraft.set(v);
//   }
//   onAttrValueInput(ev: Event) {
//     const v = (ev.target as HTMLInputElement).value ?? '';
//     this.attrValueDraft.set(v);
//   }
//   addAttr() {
//     const name = this.attrNameDraft().trim();
//     if (!name) return;
//     const entry: DynAttr = {
//       name,
//       type: this.attrTypeDraft(),
//       value: this.attrValueDraft().trim(),
//     };
//     this.attrs.set([...this.attrs(), entry]);
//     // limpiar drafts
//     this.attrNameDraft.set('');
//     this.attrValueDraft.set('');
//     this.attrTypeDraft.set('text');
//   }
//   removeAttr(index: number) {
//     const arr = [...this.attrs()];
//     arr.splice(index, 1);
//     this.attrs.set(arr);
//   }

//   // ======= Submit =======
//   async submit() {
//     this.error.set(null);
//     this.successId.set(null);

//     if (this.form.invalid) {
//       this.form.markAllAsTouched();
//       this.error.set('Completa los campos obligatorios.');
//       return;
//     }
//     if (this.files().length === 0) {
//       this.error.set('Sube al menos una imagen.');
//       return;
//     }

//     // parsear tags extra (CSV)
//     const csv = (this.form.get('tagsCsv')?.value || '') as string;
//     if (csv.trim()) this.pushTags(csv.split(','));

//     const v = this.form.getRawValue(); // incluye visibility aunque esté disabled
//     const tags = this.tags();

//     // construir categories para el backend
//     const categories = this.buildCategories();

//     const metadata: any = {
//       title: v.title?.trim(),
//       description: v.description || null,
//       country: v.country || null,
//       issueYear: v.issueYear ?? null,
//       condition: v.condition || null,
//       catalogCode: v.catalogCode || null,
//       faceValue: v.faceValue ?? null,
//       currency: v.currency || null,
//       acquisitionDate: v.acquisitionDate || null,
//       visibility: 'public',   // forzado por backend
//       tags,
//       categories
//     };

//     const fd = new FormData();
//     fd.append('metadata', JSON.stringify(metadata));
//     this.files().forEach((file, idx) => fd.append(`image${idx + 1}`, file, file.name));

//     const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
//     const headers = new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});

//     this.busy.set(true);
//     try {
//       const res = await firstValueFrom(
//         this.http.post<{ id: number }>(ENDPOINT_ITEMS, fd, { headers })
//       );
//       this.successId.set(res?.id ?? null);

//       // limpiar estado
//       this.files.set([]);
//       this.tags.set([]);
//       this.tagDraft.set('');     // 👈 FIX: string, no array
//       this.attrs.set([]);
//       this.attrNameDraft.set('');
//       this.attrValueDraft.set('');
//       this.attrTypeDraft.set('text');

//       // Reset conservando 'public'
//       this.form.reset({ visibility: 'public', tagsCsv: '' });
//       this.form.get('visibility')?.disable({ emitEvent: false, onlySelf: true });

//       // if (res?.id) this.router.navigate(['/items', res.id]);
//     } catch (e: any) {
//       this.error.set(e?.error?.message || e?.message || 'Error subiendo la pieza');
//     } finally {
//       this.busy.set(false);
//     }
//   }
// }

import { Component, signal, computed, inject, ViewEncapsulation, OnInit, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders, HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PLATFORM_ID } from '@angular/core';

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
  private http = inject(HttpClient);
  private router = inject(Router);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

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

    // === NUEVO: detectar navegador y evaluar auth/roles ===
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      // Si no hay token o está vencido, limpiar y forzar login con returnUrl
      if (!token || isExpired(token)) {
        localStorage.clear();
        sessionStorage.clear();
        this.isAuth = false;
        this.isAdmin = false;
        // Redirige conservando destino (/items/upload)
        this.goLogin(this.router.url);
        return;
      }

      this.isAuth = true;
      const role = getRoleFromToken(token);
      this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
    }
  }

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

    fetch('/auth/logout', {
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

  // Convierte los attrs de UI a `categories` que consume /items
  private buildCategories(): CategoryPayload[] {
    const out: (CategoryPayload | null)[] = this.attrs().map(a => {
      const name = a.name?.trim();
      if (!name) return null;

      if (a.type === 'number') {
        const n = Number(String(a.value).replace(',', '.').trim());
        if (!Number.isFinite(n)) return null;
        return { name, attrType: 'number', value: n } as const;
      }

      if (a.type === 'date') {
        const v = String(a.value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; // YYYY-MM-DD
        return { name, attrType: 'date', value: v } as const;
      }

      // text / list
      const v = String(a.value || '').trim();
      if (!v) return null;
      return { name, attrType: a.type, value: v } as const;
    });

    return out.filter((x): x is CategoryPayload => !!x);
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
      if (!this.allowedTypes.has(f.type)) { errors.push(`Formato no soportado: ${f.name}`); continue; }
      if (f.size > this.maxFileMB * 1024 * 1024) { errors.push(`Archivo > ${this.maxFileMB}MB: ${f.name}`); continue; }
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
  addAttr() {
    const name = this.attrNameDraft().trim();
    if (!name) return;
    const entry: DynAttr = {
      name,
      type: this.attrTypeDraft(),
      value: this.attrValueDraft().trim(),
    };
    this.attrs.set([...this.attrs(), entry]);
    // limpiar drafts
    this.attrNameDraft.set('');
    this.attrValueDraft.set('');
    this.attrTypeDraft.set('text');
  }
  removeAttr(index: number) {
    const arr = [...this.attrs()];
    arr.splice(index, 1);
    this.attrs.set(arr);
  }

  // ======= Submit =======
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

    // parsear tags extra (CSV)
    const csv = (this.form.get('tagsCsv')?.value || '') as string;
    if (csv.trim()) this.pushTags(csv.split(','));

    const v = this.form.getRawValue(); // incluye visibility aunque esté disabled
    const tags = this.tags();

    // construir categories para el backend
    const categories = this.buildCategories();

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
      visibility: 'public',   // forzado por backend
      tags,
      categories
    };

    const fd = new FormData();
    fd.append('metadata', JSON.stringify(metadata));
    this.files().forEach((file, idx) => fd.append(`image${idx + 1}`, file, file.name));

    const token = (this.isBrowser && (localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'))) || '';
    const headers = new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ id: number }>(ENDPOINT_ITEMS, fd, { headers })
      );
      this.successId.set(res?.id ?? null);

      // limpiar estado
      this.files.set([]);
      this.tags.set([]);
      this.tagDraft.set('');     // 👈 FIX: string, no array
      this.attrs.set([]);
      this.attrNameDraft.set('');
      this.attrValueDraft.set('');
      this.attrTypeDraft.set('text');

      // Reset conservando 'public'
      this.form.reset({ visibility: 'public', tagsCsv: '' });
      this.form.get('visibility')?.disable({ emitEvent: false, onlySelf: true });

      // if (res?.id) this.router.navigate(['/items', res.id]);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || 'Error subiendo la pieza');
    } finally {
      this.busy.set(false);
    }
  }
}
