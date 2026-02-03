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

// import {
//   Component,
//   ViewEncapsulation,
//   inject,
//   signal,
//   OnInit,
//   Inject,
// } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ActivatedRoute, Router, RouterModule } from '@angular/router';
// import {
//   HttpClient,
//   HttpClientModule,
//   HttpHeaders,
// } from '@angular/common/http';
// import { forkJoin, of } from 'rxjs';
// import { catchError } from 'rxjs/operators';
// import { PLATFORM_ID } from '@angular/core';
// import { FormsModule } from '@angular/forms'; // ✅ 1) IMPORTA FormsModule

// import { environment } from '../../../../core/environments/environment.prod';

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

// type Visibility = 'public' | 'private' | string;

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
//   acquisitionDate: string | null; // YYYY-MM-DD
//   visibility: Visibility | null;
//   cover: string | null;
//   createdAt?: string | null;
//   updatedAt?: string | null;
//   tags?: Tag[];
//   attributes?: AttributeValue[];
//   images?: ImageRef[];
// };

// /** Draft editable (no incluye campos “solo lectura”) */
// type ItemDraft = {
//   title: string;
//   description: string | null;
//   country: string | null;
//   issueYear: number | null;
//   conditionCode: string | null;
//   catalogCode: string | null;
//   faceValue: number | null;
//   currency: string | null;
//   acquisitionDate: string | null;
//   visibility: Visibility | null;
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

// /** Arma draft editable desde el item */
// function toDraft(it: MyItem): ItemDraft {
//   return {
//     title: it.title ?? '',
//     description: it.description ?? null,
//     country: it.country ?? null,
//     issueYear: it.issueYear ?? null,
//     conditionCode: it.conditionCode ?? null,
//     catalogCode: it.catalogCode ?? null,
//     faceValue: it.faceValue ?? null,
//     currency: it.currency ?? null,
//     acquisitionDate: it.acquisitionDate ?? null,
//     visibility: it.visibility ?? 'private',
//   };
// }

// /** Normaliza valores para enviar al backend (trim, nulls, números) */
// function cleanDraft(d: ItemDraft): ItemDraft {
//   const trimOrNull = (v: any) => {
//     const s = typeof v === 'string' ? v.trim() : v;
//     return s === '' ? null : s;
//   };

//   const numOrNull = (v: any) => {
//     if (v === null || v === undefined || v === '') return null;
//     const n = Number(v);
//     return Number.isFinite(n) ? n : null;
//   };

//   return {
//     title: (d.title ?? '').trim(),
//     description: trimOrNull(d.description),
//     country: trimOrNull(d.country),
//     issueYear: numOrNull(d.issueYear),
//     conditionCode: trimOrNull(d.conditionCode),
//     catalogCode: trimOrNull(d.catalogCode),
//     faceValue: numOrNull(d.faceValue),
//     currency: trimOrNull(d.currency),
//     acquisitionDate: trimOrNull(d.acquisitionDate),
//     visibility: trimOrNull(d.visibility),
//   };
// }

// @Component({
//   selector: 'app-item-details',
//   standalone: true,
//   imports: [CommonModule, RouterModule, HttpClientModule, FormsModule], // ✅ 2) AGREGA FormsModule AQUÍ
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
//   saving = signal(false);
//   error = signal<string | null>(null);
//   item = signal<MyItem | null>(null);

//   /** modo edición */
//   isEditing = signal(false);
//   /** draft editable */
//   draft = signal<ItemDraft | null>(null);

//   /** id actual */
//   currentId = signal<number | null>(null);

//   isBrowser = false;

//   // ✅ 3) GETTER para usar en el HTML como draftValue.xxx
//   get draftValue(): ItemDraft {
//     return (
//       this.draft() ?? {
//         title: '',
//         description: null,
//         country: null,
//         issueYear: null,
//         conditionCode: null,
//         catalogCode: null,
//         faceValue: null,
//         currency: null,
//         acquisitionDate: null,
//         visibility: 'private',
//       }
//     );
//   }

//   ngOnInit(): void {
//     this.isBrowser = isPlatformBrowser(this.platformId);

//     this.route.paramMap.subscribe((pm) => {
//       const id = Number(pm.get('id'));
//       if (!id) {
//         this.error.set('ID inválido.');
//         return;
//       }
//       this.currentId.set(id);
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

//           forkJoin({
//             tags: this.http
//               .get<Tag[]>(`${API_BASE}/items/${id}/tags`, {
//                 headers: this.buildHeaders(),
//               })
//               .pipe(catchError(() => of((base.tags as Tag[]) ?? []))),
//             attrs: this.http
//               .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, {
//                 headers: this.buildHeaders(),
//               })
//               .pipe(
//                 catchError(() => of((base.attributes as AttributeValue[]) ?? []))
//               ),
//           }).subscribe({
//             next: ({ tags, attrs }) => {
//               const merged = { ...base, tags, attributes: attrs };
//               this.item.set(merged);

//               // si NO estoy editando, refresco draft desde el item
//               if (!this.isEditing()) {
//                 this.draft.set(toDraft(merged));
//               }

//               this.busy.set(false);
//             },
//             error: () => {
//               this.item.set(base);
//               if (!this.isEditing()) this.draft.set(toDraft(base));
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

//   /** ===== Edición inline ===== */
//   startEdit() {
//     const it = this.item();
//     if (!it) return;
//     this.draft.set(toDraft(it));
//     this.isEditing.set(true);
//     this.error.set(null);
//   }

//   cancelEdit() {
//     const it = this.item();
//     if (it) this.draft.set(toDraft(it));
//     this.isEditing.set(false);
//     this.error.set(null);
//   }

//   patchDraft(patch: Partial<ItemDraft>) {
//     const d = this.draft();
//     if (!d) return;
//     this.draft.set({ ...d, ...patch });
//   }

//   /** Guardar cambios (PUT) */
//   saveEdit() {
//     const id = this.currentId();
//     const it = this.item();
//     const d = this.draft();
//     if (!id || !it || !d) return;

//     const cleaned = cleanDraft(d);

//     if (!cleaned.title) {
//       this.error.set('El título no puede estar vacío.');
//       return;
//     }

//     this.saving.set(true);
//     this.error.set(null);

//     /** ✅ CAMELCASE (alineado a tu UI) */
//     const payload = cleaned;

//     // 🟡 Si tu backend exige snake_case, cambia aquí el payload (no en el HTML)

//     this.http
//       .put(`${API_BASE}/items/${id}`, payload, { headers: this.buildHeaders() })
//       .subscribe({
//         next: (raw: any) => {
//           const updated = raw
//             ? normalizeItem(raw)
//             : ({ ...it, ...cleaned } as MyItem);

//           const prev = this.item();
//           const finalItem: MyItem = {
//             ...updated,
//             tags: prev?.tags,
//             attributes: prev?.attributes,
//             images: prev?.images,
//             cover: prev?.cover ?? updated.cover,
//           };

//           this.item.set(finalItem);
//           this.draft.set(toDraft(finalItem));
//           this.isEditing.set(false);
//           this.saving.set(false);
//         },
//         error: (err) => {
//           const msg =
//             err?.error?.message ??
//             (typeof err?.message === 'string' ? err.message : null) ??
//             'No se pudo guardar los cambios.';
//           this.error.set(msg);
//           this.saving.set(false);
//         },
//       });
//   }

//   /** Cambiar la imagen principal (solo visual). */
//   setActiveImage(img: ImageRef) {
//     const current = this.item();
//     if (!current || !img?.file) return;
//     this.item.set({ ...current, cover: img.file });
//   }

//   /** Ir a editar (si mantienes /items/upload) */
//   goEdit(id: number) {
//     this.router.navigate(['/items/upload'], {
//       queryParams: { id },
//     });
//   }

//   /** Crear nueva pieza “duplicando” desde esta */
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

// import {
//   Component,
//   ViewEncapsulation,
//   inject,
//   signal,
//   OnInit,
//   Inject,
// } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ActivatedRoute, Router, RouterModule } from '@angular/router';
// import {
//   HttpClient,
//   HttpClientModule,
//   HttpHeaders,
// } from '@angular/common/http';
// import { forkJoin, of } from 'rxjs';
// import { catchError, switchMap } from 'rxjs/operators';
// import { PLATFORM_ID } from '@angular/core';
// import { FormsModule } from '@angular/forms';

// import { environment } from '../../../../core/environments/environment.prod';

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

// type Visibility = 'public' | 'private' | string;

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
//   acquisitionDate: string | null; // YYYY-MM-DD
//   visibility: Visibility | null;
//   cover: string | null;
//   createdAt?: string | null;
//   updatedAt?: string | null;
//   tags?: Tag[];
//   attributes?: AttributeValue[];
//   images?: ImageRef[];
// };

// /** Draft editable (no incluye campos “solo lectura”) */
// type ItemDraft = {
//   title: string;
//   description: string | null;
//   country: string | null;
//   issueYear: number | null;
//   conditionCode: string | null;
//   catalogCode: string | null;
//   faceValue: number | null;
//   currency: string | null;
//   acquisitionDate: string | null;
//   visibility: Visibility | null;
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

// /** Arma draft editable desde el item */
// function toDraft(it: MyItem): ItemDraft {
//   return {
//     title: it.title ?? '',
//     description: it.description ?? null,
//     country: it.country ?? null,
//     issueYear: it.issueYear ?? null,
//     conditionCode: it.conditionCode ?? null,
//     catalogCode: it.catalogCode ?? null,
//     faceValue: it.faceValue ?? null,
//     currency: it.currency ?? null,
//     acquisitionDate: it.acquisitionDate ?? null,
//     visibility: it.visibility ?? 'private',
//   };
// }

// /** Normaliza valores para enviar al backend (trim, nulls, números) */
// function cleanDraft(d: ItemDraft): ItemDraft {
//   const trimOrNull = (v: any) => {
//     const s = typeof v === 'string' ? v.trim() : v;
//     return s === '' ? null : s;
//   };

//   const numOrNull = (v: any) => {
//     if (v === null || v === undefined || v === '') return null;
//     const n = Number(v);
//     return Number.isFinite(n) ? n : null;
//   };

//   return {
//     title: (d.title ?? '').trim(),
//     description: trimOrNull(d.description),
//     country: trimOrNull(d.country),
//     issueYear: numOrNull(d.issueYear),
//     conditionCode: trimOrNull(d.conditionCode),
//     catalogCode: trimOrNull(d.catalogCode),
//     faceValue: numOrNull(d.faceValue),
//     currency: trimOrNull(d.currency),
//     acquisitionDate: trimOrNull(d.acquisitionDate),
//     visibility: trimOrNull(d.visibility),
//   };
// }

// /**
//  * ✅ Construye payload SOLO con campos tocados (para no “pisar” valores con null/blanco).
//  * - Si el usuario no tocó un campo, NO se envía.
//  *
//  * ⚠️ Nota TS: con "exactOptionalPropertyTypes" el assign dinámico da error.
//  * Lo resolvemos con cast controlado.
//  */
// function buildTouchedPayload(
//   cleaned: ItemDraft,
//   touched: Set<keyof ItemDraft>
// ): Partial<ItemDraft> {
//   const payload: Partial<ItemDraft> = {};
//   touched.forEach((k) => {
//     (payload as any)[k] = cleaned[k];
//   });
//   return payload;
// }

// @Component({
//   selector: 'app-item-details',
//   standalone: true,
//   imports: [CommonModule, RouterModule, HttpClientModule, FormsModule],
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
//   saving = signal(false);
//   error = signal<string | null>(null);
//   item = signal<MyItem | null>(null);

//   /** modo edición */
//   isEditing = signal(false);
//   /** draft editable */
//   draft = signal<ItemDraft | null>(null);

//   /** id actual */
//   currentId = signal<number | null>(null);

//   isBrowser = false;

//   /** ✅ para no sobre-escribir con null/blancos */
//   private touched = new Set<keyof ItemDraft>();

//   /** ===== TAGS (para el HTML) ===== */
//   allTags: Tag[] = []; // catálogo completo
//   selectedTagId: number | null = null; // select "Agregar tag…"
//   newTagName = ''; // input crear tag nuevo
//   draftTags: Tag[] = []; // tags en edición (los que se guardarán)
//   private tagsTouched = false;

//   // ✅ GETTER para usar en el HTML como draftValue.xxx
//   get draftValue(): ItemDraft {
//     return (
//       this.draft() ?? {
//         title: '',
//         description: null,
//         country: null,
//         issueYear: null,
//         conditionCode: null,
//         catalogCode: null,
//         faceValue: null,
//         currency: null,
//         acquisitionDate: null,
//         visibility: 'private',
//       }
//     );
//   }

//   ngOnInit(): void {
//     this.isBrowser = isPlatformBrowser(this.platformId);

//     this.route.paramMap.subscribe((pm) => {
//       const id = Number(pm.get('id'));
//       if (!id) {
//         this.error.set('ID inválido.');
//         return;
//       }
//       this.currentId.set(id);
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

//   /** ✅ Carga catálogo de tags (para el select). Ajusta el endpoint si el tuyo es distinto. */
//   private fetchAllTags() {
//     return this.http
//       .get<Tag[]>(`${API_BASE}/tags`, { headers: this.buildHeaders() })
//       .pipe(catchError(() => of([] as Tag[])));
//   }

//   /**
//    * Carga el item y completa tags/attributes desde endpoints dedicados.
//    * ✅ Además:
//    * - setea draftTags con los tags reales del item (para que NO se vea “vacío” al editar)
//    * - precarga allTags (catálogo)
//    */
//   private fetchItem(id: number) {
//     this.busy.set(true);
//     this.error.set(null);

//     this.http
//       .get(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
//       .pipe(
//         switchMap((raw) => {
//           const base = normalizeItem(raw);

//           return forkJoin({
//             base: of(base),
//             tags: this.http
//               .get<Tag[]>(`${API_BASE}/items/${id}/tags`, {
//                 headers: this.buildHeaders(),
//               })
//               .pipe(catchError(() => of((base.tags as Tag[]) ?? []))),
//             attrs: this.http
//               .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, {
//                 headers: this.buildHeaders(),
//               })
//               .pipe(
//                 catchError(() => of((base.attributes as AttributeValue[]) ?? []))
//               ),
//             allTags: this.fetchAllTags(),
//           });
//         })
//       )
//       .subscribe({
//         next: ({ base, tags, attrs, allTags }) => {
//           const merged = { ...base, tags, attributes: attrs };
//           this.item.set(merged);

//           // catálogo tags
//           this.allTags = allTags ?? [];

//           // ✅ siempre mantenemos copia “real” de tags en draftTags cuando cargamos
//           this.draftTags = Array.isArray(tags) ? [...tags] : [];
//           this.tagsTouched = false;

//           // si NO estoy editando, refresco draft desde el item
//           if (!this.isEditing()) {
//             this.draft.set(toDraft(merged));
//           }

//           // reset touched
//           this.touched.clear();

//           this.busy.set(false);
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

//   /** ===== Edición inline ===== */
//   startEdit() {
//     const it = this.item();
//     if (!it) return;

//     this.draft.set(toDraft(it));
//     this.isEditing.set(true);
//     this.error.set(null);

//     // ✅ reset de touched para que solo se envíen cambios reales
//     this.touched.clear();

//     // ✅ tags: carga desde item (originales)
//     this.draftTags = Array.isArray(it.tags) ? [...it.tags] : [];
//     this.tagsTouched = false;

//     // ✅ si aún no hay catálogo, intentamos traerlo
//     if (!this.allTags?.length) {
//       this.fetchAllTags().subscribe((t) => (this.allTags = t ?? []));
//     }
//   }

//   cancelEdit() {
//     const it = this.item();
//     if (it) this.draft.set(toDraft(it));
//     this.isEditing.set(false);
//     this.error.set(null);

//     // ✅ vuelve a estado original (sin cambios)
//     this.touched.clear();
//     this.tagsTouched = false;
//     this.draftTags = Array.isArray(it?.tags) ? [...(it!.tags as Tag[])] : [];
//     this.selectedTagId = null;
//     this.newTagName = '';
//   }

//   patchDraft(patch: Partial<ItemDraft>) {
//     const d = this.draft();
//     if (!d) return;

//     // ✅ marca campos tocados (para no mandar nulls/blancos sin querer)
//     (Object.keys(patch) as (keyof ItemDraft)[]).forEach((k) => {
//       this.touched.add(k);
//     });

//     this.draft.set({ ...d, ...patch });
//   }

//   /** ===== TAGS helpers (usados por el HTML) ===== */
//   isTagSelected(tagId: number): boolean {
//     return this.draftTags.some((t) => t.id === tagId);
//   }

//   onSelectTag(tagId: number | null) {
//     this.selectedTagId = tagId;

//     if (!tagId) return;

//     const found = this.allTags.find((t) => t.id === tagId);
//     if (!found) return;

//     if (!this.isTagSelected(found.id)) {
//       this.draftTags = [...this.draftTags, found];
//       this.tagsTouched = true;
//     }

//     // resetea el select
//     this.selectedTagId = null;
//   }

//   removeDraftTag(tagId: number) {
//     this.draftTags = this.draftTags.filter((t) => t.id !== tagId);
//     this.tagsTouched = true;
//   }

//   /** Crea un tag nuevo y lo agrega a draftTags. Ajusta endpoint si es distinto. */
//   addNewTagFromInput() {
//     const name = (this.newTagName ?? '').trim();
//     if (!name) return;

//     // si ya existe en catálogo, lo agregamos directamente
//     const existing = this.allTags.find(
//       (t) => t.name.toLowerCase() === name.toLowerCase()
//     );
//     if (existing) {
//       if (!this.isTagSelected(existing.id)) {
//         this.draftTags = [...this.draftTags, existing];
//         this.tagsTouched = true;
//       }
//       this.newTagName = '';
//       return;
//     }

//     // si no existe, lo creamos en backend
//     this.http
//       .post<Tag>(
//         `${API_BASE}/tags`,
//         { name },
//         { headers: this.buildHeaders() }
//       )
//       .pipe(catchError(() => of(null as any)))
//       .subscribe((created) => {
//         if (!created?.id) return;

//         this.allTags = [...this.allTags, created];
//         this.draftTags = [...this.draftTags, created];
//         this.tagsTouched = true;

//         this.newTagName = '';
//       });
//   }

//   /** ✅ Update tags del item: ajusta endpoint/payload si tu backend usa otra forma */
//   private saveTagsForItem(itemId: number) {
//     const tagIds = this.draftTags.map((t) => t.id);

//     // EJEMPLO: PUT /items/:id/tags  body { tagIds: [...] }
//     return this.http
//       .put(
//         `${API_BASE}/items/${itemId}/tags`,
//         { tagIds },
//         { headers: this.buildHeaders() }
//       )
//       .pipe(catchError(() => of(null)));
//   }

//   /** Guardar cambios */
//   saveEdit() {
//     const id = this.currentId();
//     const it = this.item();
//     const d = this.draft();
//     if (!id || !it || !d) return;

//     const cleaned = cleanDraft(d);

//     // título obligatorio: si no lo tocó, igual validamos el que ya existe
//     const effectiveTitle =
//       (this.touched.has('title') ? cleaned.title : it.title) ?? '';
//     if (!effectiveTitle.trim()) {
//       this.error.set('El título no puede estar vacío.');
//       return;
//     }

//     this.saving.set(true);
//     this.error.set(null);

//     // ✅ SOLO mandamos campos tocados (para no pisar con null / blanco)
//     const touchedPayload = buildTouchedPayload(cleaned, this.touched);

//     // 🟡 Si tu backend exige snake_case, mapea SOLO touchedPayload aquí.
//     const payload = touchedPayload;

//     // 1) guardar campos principales
//     const saveItem$ =
//       Object.keys(payload).length > 0
//         ? this.http.put(`${API_BASE}/items/${id}`, payload, {
//             headers: this.buildHeaders(),
//           })
//         : of(null); // si no cambió nada en campos, no pegamos PUT

//     // 2) guardar tags si se tocaron
//     const saveTags$ = this.tagsTouched ? this.saveTagsForItem(id) : of(null);

//     forkJoin({
//       itemRes: saveItem$,
//       tagsRes: saveTags$,
//     }).subscribe({
//       next: ({ itemRes }) => {
//         // ✅ armamos el item final con “lo real” (sin vaciar)
//         const baseUpdated = itemRes ? normalizeItem(itemRes) : it;

//         // Mantén tags/attrs originales del item actual, pero reemplaza tags si tocó tags
//         const finalTags = this.tagsTouched ? [...this.draftTags] : it.tags;

//         const finalItem: MyItem = {
//           ...it, // base original
//           ...baseUpdated, // lo que haya devuelto backend
//           tags: finalTags,
//           attributes: it.attributes,
//           images: it.images,
//           cover: it.cover ?? baseUpdated.cover,
//         };

//         // ✅ aplicar SOLO lo tocado a nivel UI (no todo cleaned)
//         (Object.keys(payload) as (keyof ItemDraft)[]).forEach((k) => {
//           (finalItem as any)[k] = (payload as any)[k];
//         });

//         this.item.set(finalItem);
//         this.draft.set(toDraft(finalItem));
//         this.isEditing.set(false);

//         // reset flags
//         this.touched.clear();
//         this.tagsTouched = false;
//         this.selectedTagId = null;
//         this.newTagName = '';

//         this.saving.set(false);
//       },
//       error: (err) => {
//         const msg =
//           err?.error?.message ??
//           (typeof err?.message === 'string' ? err.message : null) ??
//           'No se pudo guardar los cambios.';
//         this.error.set(msg);
//         this.saving.set(false);
//       },
//     });
//   }

//   /** Cambiar la imagen principal (solo visual). */
//   setActiveImage(img: ImageRef) {
//     const current = this.item();
//     if (!current || !img?.file) return;
//     this.item.set({ ...current, cover: img.file });
//   }

//   /** Ir a editar (si mantienes /items/upload) */
//   goEdit(id: number) {
//     this.router.navigate(['/items/upload'], {
//       queryParams: { id },
//     });
//   }

//   /** Crear nueva pieza “duplicando” desde esta */
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
  ViewChildren,
  ViewChild,
  QueryList,
  ElementRef,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../core/environments/environment.prod';

const API_BASE = environment.apiBaseUrl;

/** ===== Tipados ===== **/
type ItemTag = { id: number; name: string };

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
  tags?: ItemTag[];
  attributes?: AttributeValue[];
  images?: ImageRef[];
};

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

function pickCoverFromImages(imgs: ImageRef[] | undefined, fallback?: any): string | null {
  const arr = Array.isArray(imgs) ? imgs : [];
  const primary = arr.find((im) => !!im?.primary && !!im?.file)?.file ?? null;
  const first = arr.find((im) => !!im?.file)?.file ?? null;
  const rawCover = typeof fallback?.cover === 'string' ? fallback.cover : null;
  return primary || first || rawCover || null;
}

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

function buildTouchedPayload(cleaned: ItemDraft, touched: Set<keyof ItemDraft>): Partial<ItemDraft> {
  const payload: Partial<ItemDraft> = {};
  touched.forEach((k) => {
    (payload as any)[k] = cleaned[k];
  });
  return payload;
}

function normalizeTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = String(raw ?? '').trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function errorMessage(err: any, fallback: string) {
  return err?.error?.message ?? (typeof err?.message === 'string' ? err.message : null) ?? fallback;
}

@Component({
  selector: 'app-item-details',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule, FormsModule],
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

  isEditing = signal(false);
  draft = signal<ItemDraft | null>(null);

  currentId = signal<number | null>(null);

  isBrowser = false;

  private touched = new Set<keyof ItemDraft>();

  /** ===== TAGS (solo renombrar texto) ===== */
  draftTagNames: string[] = [];
  newTagName = '';
  private tagsTouched = false;

  @ViewChildren('tagInput') tagInputs!: QueryList<ElementRef<HTMLInputElement>>;
  @ViewChild('newTagInput') newTagInput?: ElementRef<HTMLInputElement>;

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

  focusNewTagInput() {
    if (!this.isBrowser) return;
    setTimeout(() => this.newTagInput?.nativeElement?.focus(), 0);
  }

  focusTag(index: number) {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el = this.tagInputs?.toArray?.()[index]?.nativeElement;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
  }

  private buildHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();

    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  private fetchItem(id: number) {
    this.busy.set(true);
    this.error.set(null);

    this.http
      .get(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() })
      .pipe(
        switchMap((raw) => {
          const base = normalizeItem(raw);

          return forkJoin({
            base: of(base),
            tags: this.http
              .get<ItemTag[]>(`${API_BASE}/items/${id}/tags`, { headers: this.buildHeaders() })
              .pipe(catchError(() => of((base.tags as ItemTag[]) ?? []))),
            attrs: this.http
              .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, { headers: this.buildHeaders() })
              .pipe(catchError(() => of((base.attributes as AttributeValue[]) ?? []))),
          });
        })
      )
      .subscribe({
        next: ({ base, tags, attrs }) => {
          const merged = { ...base, tags, attributes: attrs };
          this.item.set(merged);

          this.draftTagNames = normalizeTagNames(Array.isArray(tags) ? tags.map((t) => t.name) : []);
          this.tagsTouched = false;

          if (!this.isEditing()) this.draft.set(toDraft(merged));

          this.touched.clear();
          this.busy.set(false);
        },
        error: (err) => {
          this.error.set(errorMessage(err, 'No se pudo cargar el item.'));
          this.busy.set(false);
        },
      });
  }

  startEdit() {
    const it = this.item();
    if (!it) return;

    this.draft.set(toDraft(it));
    this.isEditing.set(true);
    this.error.set(null);

    this.touched.clear();

    this.draftTagNames = normalizeTagNames(Array.isArray(it.tags) ? it.tags.map((t) => t.name) : []);
    this.tagsTouched = false;
    this.newTagName = '';

    this.focusNewTagInput();
  }

  cancelEdit() {
    const it = this.item();
    if (it) this.draft.set(toDraft(it));
    this.isEditing.set(false);
    this.error.set(null);

    this.touched.clear();
    this.tagsTouched = false;

    this.draftTagNames = normalizeTagNames(
      Array.isArray(it?.tags) ? (it!.tags as ItemTag[]).map((t) => t.name) : []
    );
    this.newTagName = '';
  }

  patchDraft(patch: Partial<ItemDraft>) {
    const d = this.draft();
    if (!d) return;

    (Object.keys(patch) as (keyof ItemDraft)[]).forEach((k) => this.touched.add(k));
    this.draft.set({ ...d, ...patch });
  }

  /** ===== TAGS helpers (solo renombrar) ===== */

  // ⚠️ Si tu regla es "solo renombrar", idealmente NO permitir agregar desde aquí.
  // Si quieres permitirlo, ya no es "solo renombrar" y se requiere backend /items/:id/tags.
  addNewTagFromInput() {
    const name = (this.newTagName ?? '').trim();
    if (!name) return;

    const before = this.draftTagNames;
    const after = normalizeTagNames([...before, name]);

    if (after.length !== before.length) {
      this.draftTagNames = after;
      this.tagsTouched = true;
    }

    this.newTagName = '';
    this.focusNewTagInput();
  }

  trackByIndex(index: number) {
    return index;
  }
  
  // renameDraftTagAt(index: number, newName: string) {
  //   const arr = [...this.draftTagNames];
  //   if (index < 0 || index >= arr.length) return;

  //   const before = String(arr[index] ?? '').trim();
  //   const afterName = String(newName ?? '').trim();

  //   arr[index] = newName;
  //   const normalized = normalizeTagNames(arr);

  //   this.draftTagNames = normalized;
  //   if (before !== afterName) this.tagsTouched = true;
  // }
  renameDraftTagAt(index: number, newName: string) {
    if (index < 0 || index >= this.draftTagNames.length) return;
  
    const arr = [...this.draftTagNames];
    arr[index] = newName; // ✅ NO normalizar aquí
    this.draftTagNames = arr;
  
    this.tagsTouched = true;
  }
  

  removeDraftTagAt(index: number) {
    const arr = [...this.draftTagNames];
    if (index < 0 || index >= arr.length) return;

    arr.splice(index, 1);
    this.draftTagNames = arr;
    this.tagsTouched = true;

    const next = Math.min(index, this.draftTagNames.length - 1);
    if (next >= 0) this.focusTag(next);
    else this.focusNewTagInput();
  }

  /** ✅ SOLO RENOMBRAR TAGS EXISTENTES: PUT /tags/:id */
  private renameTagsOnly(itemId: number) {
    const it = this.item();
    const currentTags = Array.isArray(it?.tags) ? (it!.tags as ItemTag[]) : [];
    const newNames = normalizeTagNames(this.draftTagNames);

    // Si cambió la cantidad, ya NO es renombrar (sería agregar/quitar)
    if (newNames.length !== currentTags.length) {
      throw new Error(
        'Solo se permite renombrar tags existentes. No se puede agregar/eliminar tags aquí.'
      );
    }

    const calls = currentTags.map((t, idx) => {
      const newName = String(newNames[idx] ?? '').trim();
      if (!newName || newName === t.name) return of(null);

      return this.http.put<ItemTag>(
        `${API_BASE}/tags/${t.id}`,
        { name: newName },
        { headers: this.buildHeaders() }
      );
    });

    return forkJoin(calls); // (ItemTag | null)[]
  }

  saveEdit() {
    const id = this.currentId();
    const it = this.item();
    const d = this.draft();
    if (!id || !it || !d) return;

    const cleaned = cleanDraft(d);

    const effectiveTitle = (this.touched.has('title') ? cleaned.title : it.title) ?? '';
    if (!effectiveTitle.trim()) {
      this.error.set('El título no puede estar vacío.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const payload = buildTouchedPayload(cleaned, this.touched);

    const saveItem$ =
      Object.keys(payload).length > 0
        ? this.http.put(`${API_BASE}/items/${id}`, payload, { headers: this.buildHeaders() })
        : of(null);

    // ✅ CAMBIO: antes era /items/:id/tags, ahora renombra con /tags/:id
    const saveTags$ = this.tagsTouched ? this.renameTagsOnly(id) : of(null);

    forkJoin({ itemRes: saveItem$, tagsRes: saveTags$ }).subscribe({
      next: ({ itemRes, tagsRes }) => {
        const baseUpdated = itemRes ? normalizeItem(itemRes) : it;

        let finalTags: ItemTag[] | undefined = it.tags;

        if (this.tagsTouched) {
          if (!Array.isArray(tagsRes)) {
            throw new Error('No se pudo guardar tags (respuesta inválida).');
          }

          // tagsRes = (ItemTag | null)[]
          const updatedById = new Map<number, ItemTag>();
          for (const r of tagsRes as Array<ItemTag | null>) {
            if (r && typeof r.id === 'number') updatedById.set(r.id, r);
          }

          finalTags = (Array.isArray(it.tags) ? it.tags : []).map((t) => updatedById.get(t.id) ?? t);
        }

        const finalItem: MyItem = {
          ...it,
          ...baseUpdated,
          tags: finalTags,
          attributes: it.attributes,
          images: it.images,
          cover: it.cover ?? baseUpdated.cover,
        };

        (Object.keys(payload) as (keyof ItemDraft)[]).forEach((k) => {
          (finalItem as any)[k] = (payload as any)[k];
        });

        this.item.set(finalItem);
        this.draft.set(toDraft(finalItem));
        this.isEditing.set(false);

        this.touched.clear();
        this.tagsTouched = false;
        this.newTagName = '';

        this.draftTagNames = normalizeTagNames(Array.isArray(finalTags) ? finalTags.map((t) => t.name) : []);

        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'No se pudo guardar los cambios.'));
        this.saving.set(false);
      },
    });
  }

  setActiveImage(img: ImageRef) {
    const current = this.item();
    if (!current || !img?.file) return;
    this.item.set({ ...current, cover: img.file });
  }

  goEdit(id: number) {
    this.router.navigate(['/items/upload'], { queryParams: { id } });
  }

  goUploadNewFrom(id: number) {
    this.router.navigate(['/items/upload'], { queryParams: { from: id } });
  }

  confirmDelete(id: number) {
    if (!this.isBrowser) return;
    const ok = window.confirm('¿Estás segura de eliminar esta pieza? Esta acción no se puede deshacer.');
    if (!ok) return;
    this.deleteItem(id);
  }

  private deleteItem(id: number) {
    this.busy.set(true);
    this.error.set(null);

    this.http.delete(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() }).subscribe({
      next: () => {
        this.busy.set(false);
        this.router.navigate(['/items/mine']);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'No se pudo eliminar la pieza.'));
        this.busy.set(false);
      },
    });
  }

  selectAll(ev: Event) {
    const el = ev.target as HTMLInputElement | null;
    if (!el) return;
    // espera 0ms para que el focus termine de aplicarse
    setTimeout(() => {
      el.select();
    }, 0);
  }
  
  goBack() {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl) {
      this.router.navigateByUrl(returnUrl);
    } else {
      this.router.navigateByUrl('/items/mine');
    }
  }
}
