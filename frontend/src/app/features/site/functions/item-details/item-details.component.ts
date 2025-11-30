// // src/app/features/items/item-details/item-details.component.ts
// import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ActivatedRoute, RouterModule } from '@angular/router';
// import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
// import { forkJoin, of } from 'rxjs';
// import { catchError } from 'rxjs/operators';

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
//   images?: ImageRef[];         // 👈 ahora incluimos las imágenes
// };

// /** Utilidad: elegir cover desde images (primaria o primera). */
// function pickCoverFromImages(imgs: ImageRef[] | undefined, fallback?: any): string | null {
//   const arr = Array.isArray(imgs) ? imgs : [];
//   const primary = arr.find(im => !!(im?.primary) && !!im?.file)?.file ?? null;
//   const first   = arr.find(im => !!im?.file)?.file ?? null;
//   // si el backend ya manda cover, úsalo como último fallback
//   const rawCover = typeof fallback?.cover === 'string' ? fallback.cover : null;
//   return primary || first || rawCover || null;
// }

// /** Mapea snake_case → camelCase, y arma cover desde images. */
// function normalizeItem(raw: any): MyItem {
//   if (!raw) throw new Error('Item vacío');

//   // Normalizar images del backend (/items/:id devuelve i.* + images[])
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
//       cover: pickCoverFromImages(images, raw), // 👈 construir cover
//       createdAt: raw.createdAt ?? null,
//       updatedAt: raw.updatedAt ?? null,
//       tags: raw.tags ?? undefined,
//       attributes: raw.attributes ?? undefined,
//       images, // 👈 guardar también el array
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
//     cover: pickCoverFromImages(images, raw), // 👈 construir cover
//     createdAt: raw.created_at ?? null,
//     updatedAt: raw.updated_at ?? null,
//     tags: raw.tags ?? undefined,
//     attributes: raw.attributes ?? undefined,
//     images, // 👈 guardar también el array
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
// export class ItemDetailsComponent {
//   private http = inject(HttpClient);
//   private route = inject(ActivatedRoute);

//   busy = signal(false);
//   error = signal<string | null>(null);
//   item = signal<MyItem | null>(null);

//   constructor() {
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
//     const token =
//       localStorage.getItem('accessToken') ||
//       sessionStorage.getItem('accessToken') ||
//       '';
//     return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
//   }

//   /** Carga el item base y completa tags/attributes si hace falta. */
//   private fetchItem(id: number) {
//     this.busy.set(true);
//     this.error.set(null);

//     // ✅ /items/:id requiere Authorization
//     this.http.get(`/items/${id}`, { headers: this.buildHeaders() }).subscribe({
//       next: (raw) => {
//         const base = normalizeItem(raw);

//         const needsTags = !Array.isArray(base.tags);
//         const needsAttrs = !Array.isArray(base.attributes);

//         if (!needsTags && !needsAttrs) {
//           this.item.set(base);
//           this.busy.set(false);
//           return;
//         }

//         forkJoin({
//           tags: needsTags
//             ? this.http
//                 .get<Tag[]>(`/items/${id}/tags`, { headers: this.buildHeaders() })
//                 .pipe(catchError(() => of([] as Tag[])))
//             : of(base.tags as Tag[]),
//           attrs: needsAttrs
//             ? this.http
//                 .get<AttributeValue[]>(`/items/${id}/attributes`, { headers: this.buildHeaders() })
//                 .pipe(catchError(() => of([] as AttributeValue[])))
//             : of(base.attributes as AttributeValue[]),
//         }).subscribe({
//           next: ({ tags, attrs }) => {
//             this.item.set({ ...base, tags, attributes: attrs });
//             this.busy.set(false);
//           },
//           error: () => {
//             this.item.set(base);
//             this.error.set('No se pudo completar tags/atributos.');
//             this.busy.set(false);
//           },
//         });
//       },
//       error: (err) => {
//         const msg =
//           err?.error?.message ??
//           (typeof err?.message === 'string' ? err.message : null) ??
//           'No se pudo cargar el item.';
//         this.error.set(msg);
//         this.busy.set(false);
//       },
//     });
//   }
// }
// src/app/features/items/item-details/item-details.component.ts
// import {
//   Component,
//   ViewEncapsulation,
//   inject,
//   signal,
//   OnInit,
//   Inject
// } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ActivatedRoute, RouterModule } from '@angular/router';
// import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
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

//   /** Carga el item base y completa tags/attributes si hace falta. */
//   private fetchItem(id: number) {
//     this.busy.set(true);
//     this.error.set(null);

//     this.http
//       .get(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
//       .subscribe({
//         next: (raw) => {
//           const base = normalizeItem(raw);

//           const needsTags = !Array.isArray(base.tags);
//           const needsAttrs = !Array.isArray(base.attributes);

//           if (!needsTags && !needsAttrs) {
//             this.item.set(base);
//             this.busy.set(false);
//             return;
//           }

//           forkJoin({
//             tags: needsTags
//               ? this.http
//                   .get<Tag[]>(`${API_BASE}/items/${id}/tags`, {
//                     headers: this.buildHeaders(),
//                   })
//                   .pipe(catchError(() => of([] as Tag[])))
//               : of(base.tags as Tag[]),
//             attrs: needsAttrs
//               ? this.http
//                   .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, {
//                     headers: this.buildHeaders(),
//                   })
//                   .pipe(catchError(() => of([] as AttributeValue[])))
//               : of(base.attributes as AttributeValue[]),
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
// }
import {
  Component,
  ViewEncapsulation,
  inject,
  signal,
  OnInit,
  Inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  HttpClient,
  HttpClientModule,
  HttpHeaders
} from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PLATFORM_ID } from '@angular/core';

// ⭐ IMPORTA environment (ajusta la ruta igual que en los otros componentes)
import { environment } from '../../../../core/environments/environment.prod';

// ⭐ base URL del backend
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
  acquisitionDate: string | null;
  visibility: string | null;
  cover: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: Tag[];
  attributes?: AttributeValue[];
  images?: ImageRef[];
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

@Component({
  selector: 'app-item-details',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule],
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
  error = signal<string | null>(null);
  item = signal<MyItem | null>(null);
  isBrowser = false;

  constructor() {}

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);

    this.route.paramMap.subscribe((pm) => {
      const id = Number(pm.get('id'));
      if (!id) {
        this.error.set('ID inválido.');
        return;
      }
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

          // Siempre intentamos traer tags y atributos aparte;
          // si los endpoints no existen o fallan, usamos lo que ya venga en base.
          forkJoin({
            tags: this.http
              .get<Tag[]>(`${API_BASE}/items/${id}/tags`, {
                headers: this.buildHeaders(),
              })
              .pipe(
                catchError(() => of((base.tags as Tag[]) ?? []))
              ),
            attrs: this.http
              .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, {
                headers: this.buildHeaders(),
              })
              .pipe(
                catchError(() => of((base.attributes as AttributeValue[]) ?? []))
              ),
          }).subscribe({
            next: ({ tags, attrs }) => {
              this.item.set({ ...base, tags, attributes: attrs });
              this.busy.set(false);
            },
            error: () => {
              this.item.set(base);
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

  /** Cambiar la imagen principal desde la tira de thumbnails */
  setActiveImage(img: ImageRef) {
    const current = this.item();
    if (!current || !img?.file) return;
    this.item.set({ ...current, cover: img.file });
  }

  /** Ir a editar (ajusta la ruta según tu upload/editar real) */
  goEdit(id: number) {
    this.router.navigate(['/items/upload'], {
      queryParams: { id },
    });
  }

  /** Crear nueva pieza “duplicando” desde esta (solo le pasamos el id de origen) */
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
