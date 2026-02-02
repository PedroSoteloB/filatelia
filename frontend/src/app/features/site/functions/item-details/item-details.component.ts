// import {
//   Component,
//   ViewEncapsulation,
//   inject,
//   signal,
//   OnInit,
//   Inject
// } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ActivatedRoute, Router, RouterModule } from '@angular/router';
// import {
//   HttpClient,
//   HttpClientModule,
//   HttpHeaders
// } from '@angular/common/http';
// import { forkJoin, of } from 'rxjs';
// import { catchError } from 'rxjs/operators';
// import { PLATFORM_ID } from '@angular/core';

// // ⭐ IMPORTA environment (ajusta la ruta igual que en los otros componentes)
// import { environment } from '../../../../core/environments/environment.prod';

// // ⭐ base URL del backend
// const API_BASE = environment.apiBaseUrl;

// /** ===== Tipados ===== **/
// type Tag = { id: number; name: string };

// type AttributeValue = {
//   definitionId: number;
//   name: string;
//   attrType: 'text' | 'number' | 'date' | string;
//   value: string | number | null;
// };

// type ImageRef = { id: number; file: string | null; primary?: number | boolean };

// type MyItem = {
//   id: number;
//   title: string;
//   description: string | null;
//   country: string | null;
//   issueYear: number | null;
//   conditionCode: string | null;
//   catalogCode: string | null;
//   faceValue: number | null;
//   currency: string | null;
//   acquisitionDate: string | null;
//   visibility: string | null;
//   cover: string | null;
//   createdAt?: string | null;
//   updatedAt?: string | null;
//   tags?: Tag[];
//   attributes?: AttributeValue[];
//   images?: ImageRef[];
// };

// /** Utilidad: elegir cover desde images (primaria o primera). */
// function pickCoverFromImages(
//   imgs: ImageRef[] | undefined,
//   fallback?: any
// ): string | null {
//   const arr = Array.isArray(imgs) ? imgs : [];
//   const primary = arr.find((im) => !!im?.primary && !!im?.file)?.file ?? null;
//   const first = arr.find((im) => !!im?.file)?.file ?? null;
//   const rawCover = typeof fallback?.cover === 'string' ? fallback.cover : null;
//   return primary || first || rawCover || null;
// }

// /** Mapea snake_case → camelCase, y arma cover desde images. */
// function normalizeItem(raw: any): MyItem {
//   if (!raw) throw new Error('Item vacío');

//   const images: ImageRef[] = Array.isArray(raw?.images)
//     ? raw.images.map((im: any) => ({
//         id: Number(im?.id ?? 0),
//         file: im?.file ?? im?.file_path ?? null,
//         primary: !!(im?.primary ?? im?.is_primary),
//       }))
//     : [];

//   const hasCamel = Object.prototype.hasOwnProperty.call(raw, 'issueYear');
//   if (hasCamel) {
//     return {
//       id: raw.id,
//       title: raw.title,
//       description: raw.description ?? null,
//       country: raw.country ?? null,
//       issueYear: raw.issueYear ?? null,
//       conditionCode: raw.conditionCode ?? null,
//       catalogCode: raw.catalogCode ?? null,
//       faceValue: raw.faceValue ?? null,
//       currency: raw.currency ?? null,
//       acquisitionDate: raw.acquisitionDate ?? null,
//       visibility: raw.visibility ?? null,
//       cover: pickCoverFromImages(images, raw),
//       createdAt: raw.createdAt ?? null,
//       updatedAt: raw.updatedAt ?? null,
//       tags: raw.tags ?? undefined,
//       attributes: raw.attributes ?? undefined,
//       images,
//     };
//   }

//   return {
//     id: raw.id,
//     title: raw.title,
//     description: raw.description ?? null,
//     country: raw.country ?? null,
//     issueYear: raw.issue_year ?? null,
//     conditionCode: raw.condition_code ?? null,
//     catalogCode: raw.catalog_code ?? null,
//     faceValue: raw.face_value ?? null,
//     currency: raw.currency ?? null,
//     acquisitionDate: raw.acquisition_date ?? null,
//     visibility: raw.visibility ?? null,
//     cover: pickCoverFromImages(images, raw),
//     createdAt: raw.created_at ?? null,
//     updatedAt: raw.updated_at ?? null,
//     tags: raw.tags ?? undefined,
//     attributes: raw.attributes ?? undefined,
//     images,
//   };
// }

// @Component({
//   selector: 'app-item-details',
//   standalone: true,
//   imports: [CommonModule, RouterModule, HttpClientModule],
//   templateUrl: './item-details.component.html',
//   styleUrls: ['./item-details.component.scss'],
//   encapsulation: ViewEncapsulation.None,
//   host: { class: 'item-details-page block p-4' },
// })
// export class ItemDetailsComponent implements OnInit {
//   private http = inject(HttpClient);
//   private route = inject(ActivatedRoute);
//   private router = inject(Router);
//   @Inject(PLATFORM_ID) private platformId: Object = inject(PLATFORM_ID);

//   busy = signal(false);
//   error = signal<string | null>(null);
//   item = signal<MyItem | null>(null);
//   isBrowser = false;

//   constructor() {}

//   ngOnInit(): void {
//     this.isBrowser = isPlatformBrowser(this.platformId);

//     this.route.paramMap.subscribe((pm) => {
//       const id = Number(pm.get('id'));
//       if (!id) {
//         this.error.set('ID inválido.');
//         return;
//       }
//       this.fetchItem(id);
//     });
//   }

//   /** Auth header para endpoints protegidos */
//   private buildHeaders(): HttpHeaders {
//     if (!this.isBrowser) return new HttpHeaders();

//     const token =
//       localStorage.getItem('accessToken') ||
//       sessionStorage.getItem('accessToken') ||
//       '';
//     return token
//       ? new HttpHeaders({ Authorization: `Bearer ${token}` })
//       : new HttpHeaders();
//   }

//   /** Carga el item y completa tags/attributes desde endpoints dedicados. */
//   private fetchItem(id: number) {
//     this.busy.set(true);
//     this.error.set(null);

//     this.http
//       .get(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
//       .subscribe({
//         next: (raw) => {
//           const base = normalizeItem(raw);

//           // Siempre intentamos traer tags y atributos aparte;
//           // si los endpoints no existen o fallan, usamos lo que ya venga en base.
//           forkJoin({
//             tags: this.http
//               .get<Tag[]>(`${API_BASE}/items/${id}/tags`, {
//                 headers: this.buildHeaders(),
//               })
//               .pipe(
//                 catchError(() => of((base.tags as Tag[]) ?? []))
//               ),
//             attrs: this.http
//               .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, {
//                 headers: this.buildHeaders(),
//               })
//               .pipe(
//                 catchError(() => of((base.attributes as AttributeValue[]) ?? []))
//               ),
//           }).subscribe({
//             next: ({ tags, attrs }) => {
//               this.item.set({ ...base, tags, attributes: attrs });
//               this.busy.set(false);
//             },
//             error: () => {
//               this.item.set(base);
//               this.error.set('No se pudo completar tags/atributos.');
//               this.busy.set(false);
//             },
//           });
//         },
//         error: (err) => {
//           const msg =
//             err?.error?.message ??
//             (typeof err?.message === 'string' ? err.message : null) ??
//             'No se pudo cargar el item.';
//           this.error.set(msg);
//           this.busy.set(false);
//         },
//       });
//   }

//   /** Cambiar la imagen principal desde la tira de thumbnails */
//   setActiveImage(img: ImageRef) {
//     const current = this.item();
//     if (!current || !img?.file) return;
//     this.item.set({ ...current, cover: img.file });
//   }

//   /** Ir a editar (ajusta la ruta según tu upload/editar real) */
//   goEdit(id: number) {
//     this.router.navigate(['/items/upload'], {
//       queryParams: { id },
//     });
//   }

//   /** Crear nueva pieza “duplicando” desde esta (solo le pasamos el id de origen) */
//   goUploadNewFrom(id: number) {
//     this.router.navigate(['/items/upload'], {
//       queryParams: { from: id },
//     });
//   }

//   /** Confirmar y eliminar */
//   confirmDelete(id: number) {
//     if (!this.isBrowser) return;
//     const ok = window.confirm(
//       '¿Estás segura de eliminar esta pieza? Esta acción no se puede deshacer.'
//     );
//     if (!ok) return;
//     this.deleteItem(id);
//   }

//   private deleteItem(id: number) {
//     this.busy.set(true);
//     this.error.set(null);

//     this.http
//       .delete(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
//       .subscribe({
//         next: () => {
//           this.busy.set(false);
//           this.router.navigate(['/items/mine']);
//         },
//         error: (err) => {
//           const msg =
//             err?.error?.message ??
//             (typeof err?.message === 'string' ? err.message : null) ??
//             'No se pudo eliminar la pieza.';
//           this.error.set(msg);
//           this.busy.set(false);
//         },
//       });
//   }
// }

import {
  Component,
  ViewEncapsulation,
  inject,
  signal,
  OnInit,
  Inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  HttpClient,
  HttpClientModule,
  HttpHeaders,
} from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms'; // ✅ 1) IMPORTA FormsModule

import { environment } from '../../../../core/environments/environment.prod';

const API_BASE = environment.apiBaseUrl;

/** ===== Tipados ===== **/
type Tag = { id: number; name: string };

type AttributeValue = {
  definitionId: number;
  name: string;
  attrType: 'text' | 'number' | 'date' | string;
  value: string | number | null;
};

type ImageRef = { id: number; file: string | null; primary?: number | boolean };

type Visibility = 'public' | 'private' | string;

type MyItem = {
  id: number;
  title: string;
  description: string | null;
  country: string | null;
  issueYear: number | null;
  conditionCode: string | null;
  catalogCode: string | null;
  faceValue: number | null;
  currency: string | null;
  acquisitionDate: string | null; // YYYY-MM-DD
  visibility: Visibility | null;
  cover: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: Tag[];
  attributes?: AttributeValue[];
  images?: ImageRef[];
};

/** Draft editable (no incluye campos “solo lectura”) */
type ItemDraft = {
  title: string;
  description: string | null;
  country: string | null;
  issueYear: number | null;
  conditionCode: string | null;
  catalogCode: string | null;
  faceValue: number | null;
  currency: string | null;
  acquisitionDate: string | null;
  visibility: Visibility | null;
};

/** Utilidad: elegir cover desde images (primaria o primera). */
function pickCoverFromImages(
  imgs: ImageRef[] | undefined,
  fallback?: any
): string | null {
  const arr = Array.isArray(imgs) ? imgs : [];
  const primary = arr.find((im) => !!im?.primary && !!im?.file)?.file ?? null;
  const first = arr.find((im) => !!im?.file)?.file ?? null;
  const rawCover = typeof fallback?.cover === 'string' ? fallback.cover : null;
  return primary || first || rawCover || null;
}

/** Mapea snake_case → camelCase, y arma cover desde images. */
function normalizeItem(raw: any): MyItem {
  if (!raw) throw new Error('Item vacío');

  const images: ImageRef[] = Array.isArray(raw?.images)
    ? raw.images.map((im: any) => ({
        id: Number(im?.id ?? 0),
        file: im?.file ?? im?.file_path ?? null,
        primary: !!(im?.primary ?? im?.is_primary),
      }))
    : [];

  const hasCamel = Object.prototype.hasOwnProperty.call(raw, 'issueYear');
  if (hasCamel) {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.description ?? null,
      country: raw.country ?? null,
      issueYear: raw.issueYear ?? null,
      conditionCode: raw.conditionCode ?? null,
      catalogCode: raw.catalogCode ?? null,
      faceValue: raw.faceValue ?? null,
      currency: raw.currency ?? null,
      acquisitionDate: raw.acquisitionDate ?? null,
      visibility: raw.visibility ?? null,
      cover: pickCoverFromImages(images, raw),
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      tags: raw.tags ?? undefined,
      attributes: raw.attributes ?? undefined,
      images,
    };
  }

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? null,
    country: raw.country ?? null,
    issueYear: raw.issue_year ?? null,
    conditionCode: raw.condition_code ?? null,
    catalogCode: raw.catalog_code ?? null,
    faceValue: raw.face_value ?? null,
    currency: raw.currency ?? null,
    acquisitionDate: raw.acquisition_date ?? null,
    visibility: raw.visibility ?? null,
    cover: pickCoverFromImages(images, raw),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    tags: raw.tags ?? undefined,
    attributes: raw.attributes ?? undefined,
    images,
  };
}

/** Arma draft editable desde el item */
function toDraft(it: MyItem): ItemDraft {
  return {
    title: it.title ?? '',
    description: it.description ?? null,
    country: it.country ?? null,
    issueYear: it.issueYear ?? null,
    conditionCode: it.conditionCode ?? null,
    catalogCode: it.catalogCode ?? null,
    faceValue: it.faceValue ?? null,
    currency: it.currency ?? null,
    acquisitionDate: it.acquisitionDate ?? null,
    visibility: it.visibility ?? 'private',
  };
}

/** Normaliza valores para enviar al backend (trim, nulls, números) */
function cleanDraft(d: ItemDraft): ItemDraft {
  const trimOrNull = (v: any) => {
    const s = typeof v === 'string' ? v.trim() : v;
    return s === '' ? null : s;
  };

  const numOrNull = (v: any) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    title: (d.title ?? '').trim(),
    description: trimOrNull(d.description),
    country: trimOrNull(d.country),
    issueYear: numOrNull(d.issueYear),
    conditionCode: trimOrNull(d.conditionCode),
    catalogCode: trimOrNull(d.catalogCode),
    faceValue: numOrNull(d.faceValue),
    currency: trimOrNull(d.currency),
    acquisitionDate: trimOrNull(d.acquisitionDate),
    visibility: trimOrNull(d.visibility),
  };
}

@Component({
  selector: 'app-item-details',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule, FormsModule], // ✅ 2) AGREGA FormsModule AQUÍ
  templateUrl: './item-details.component.html',
  styleUrls: ['./item-details.component.scss'],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'item-details-page block p-4' },
})
export class ItemDetailsComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  @Inject(PLATFORM_ID) private platformId: Object = inject(PLATFORM_ID);

  busy = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  item = signal<MyItem | null>(null);

  /** modo edición */
  isEditing = signal(false);
  /** draft editable */
  draft = signal<ItemDraft | null>(null);

  /** id actual */
  currentId = signal<number | null>(null);

  isBrowser = false;

  // ✅ 3) GETTER para usar en el HTML como draftValue.xxx
  get draftValue(): ItemDraft {
    return (
      this.draft() ?? {
        title: '',
        description: null,
        country: null,
        issueYear: null,
        conditionCode: null,
        catalogCode: null,
        faceValue: null,
        currency: null,
        acquisitionDate: null,
        visibility: 'private',
      }
    );
  }

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);

    this.route.paramMap.subscribe((pm) => {
      const id = Number(pm.get('id'));
      if (!id) {
        this.error.set('ID inválido.');
        return;
      }
      this.currentId.set(id);
      this.fetchItem(id);
    });
  }

  /** Auth header para endpoints protegidos */
  private buildHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();

    const token =
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('accessToken') ||
      '';

    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  /** Carga el item y completa tags/attributes desde endpoints dedicados. */
  private fetchItem(id: number) {
    this.busy.set(true);
    this.error.set(null);

    this.http
      .get(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
      .subscribe({
        next: (raw) => {
          const base = normalizeItem(raw);

          forkJoin({
            tags: this.http
              .get<Tag[]>(`${API_BASE}/items/${id}/tags`, {
                headers: this.buildHeaders(),
              })
              .pipe(catchError(() => of((base.tags as Tag[]) ?? []))),
            attrs: this.http
              .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, {
                headers: this.buildHeaders(),
              })
              .pipe(
                catchError(() => of((base.attributes as AttributeValue[]) ?? []))
              ),
          }).subscribe({
            next: ({ tags, attrs }) => {
              const merged = { ...base, tags, attributes: attrs };
              this.item.set(merged);

              // si NO estoy editando, refresco draft desde el item
              if (!this.isEditing()) {
                this.draft.set(toDraft(merged));
              }

              this.busy.set(false);
            },
            error: () => {
              this.item.set(base);
              if (!this.isEditing()) this.draft.set(toDraft(base));
              this.error.set('No se pudo completar tags/atributos.');
              this.busy.set(false);
            },
          });
        },
        error: (err) => {
          const msg =
            err?.error?.message ??
            (typeof err?.message === 'string' ? err.message : null) ??
            'No se pudo cargar el item.';
          this.error.set(msg);
          this.busy.set(false);
        },
      });
  }

  /** ===== Edición inline ===== */
  startEdit() {
    const it = this.item();
    if (!it) return;
    this.draft.set(toDraft(it));
    this.isEditing.set(true);
    this.error.set(null);
  }

  cancelEdit() {
    const it = this.item();
    if (it) this.draft.set(toDraft(it));
    this.isEditing.set(false);
    this.error.set(null);
  }

  patchDraft(patch: Partial<ItemDraft>) {
    const d = this.draft();
    if (!d) return;
    this.draft.set({ ...d, ...patch });
  }

  /** Guardar cambios (PUT) */
  saveEdit() {
    const id = this.currentId();
    const it = this.item();
    const d = this.draft();
    if (!id || !it || !d) return;

    const cleaned = cleanDraft(d);

    if (!cleaned.title) {
      this.error.set('El título no puede estar vacío.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    /** ✅ CAMELCASE (alineado a tu UI) */
    const payload = cleaned;

    // 🟡 Si tu backend exige snake_case, cambia aquí el payload (no en el HTML)

    this.http
      .put(`${API_BASE}/items/${id}`, payload, { headers: this.buildHeaders() })
      .subscribe({
        next: (raw: any) => {
          const updated = raw
            ? normalizeItem(raw)
            : ({ ...it, ...cleaned } as MyItem);

          const prev = this.item();
          const finalItem: MyItem = {
            ...updated,
            tags: prev?.tags,
            attributes: prev?.attributes,
            images: prev?.images,
            cover: prev?.cover ?? updated.cover,
          };

          this.item.set(finalItem);
          this.draft.set(toDraft(finalItem));
          this.isEditing.set(false);
          this.saving.set(false);
        },
        error: (err) => {
          const msg =
            err?.error?.message ??
            (typeof err?.message === 'string' ? err.message : null) ??
            'No se pudo guardar los cambios.';
          this.error.set(msg);
          this.saving.set(false);
        },
      });
  }

  /** Cambiar la imagen principal (solo visual). */
  setActiveImage(img: ImageRef) {
    const current = this.item();
    if (!current || !img?.file) return;
    this.item.set({ ...current, cover: img.file });
  }

  /** Ir a editar (si mantienes /items/upload) */
  goEdit(id: number) {
    this.router.navigate(['/items/upload'], {
      queryParams: { id },
    });
  }

  /** Crear nueva pieza “duplicando” desde esta */
  goUploadNewFrom(id: number) {
    this.router.navigate(['/items/upload'], {
      queryParams: { from: id },
    });
  }

  /** Confirmar y eliminar */
  confirmDelete(id: number) {
    if (!this.isBrowser) return;
    const ok = window.confirm(
      '¿Estás segura de eliminar esta pieza? Esta acción no se puede deshacer.'
    );
    if (!ok) return;
    this.deleteItem(id);
  }

  private deleteItem(id: number) {
    this.busy.set(true);
    this.error.set(null);

    this.http
      .delete(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.router.navigate(['/items/mine']);
        },
        error: (err) => {
          const msg =
            err?.error?.message ??
            (typeof err?.message === 'string' ? err.message : null) ??
            'No se pudo eliminar la pieza.';
          this.error.set(msg);
          this.busy.set(false);
        },
      });
  }
}
