// import {
//   Component,
//   ViewEncapsulation,
//   inject,
//   signal,
//   OnInit,
//   Inject,
//   ViewChildren,
//   ViewChild,
//   QueryList,
//   ElementRef,
// } from '@angular/core';
// import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ActivatedRoute, Router, RouterModule } from '@angular/router';
// import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
// import { forkJoin, of } from 'rxjs';
// import { catchError, switchMap } from 'rxjs/operators';
// import { PLATFORM_ID } from '@angular/core';
// import { FormsModule } from '@angular/forms';

// import { environment } from '../../../../core/environments/environment.prod';

// const API_BASE = environment.apiBaseUrl;

// /** ===== Tipados ===== **/
// type ItemTag = { id: number; name: string };

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
//   tags?: ItemTag[];
//   attributes?: AttributeValue[];
//   images?: ImageRef[];
// };

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

// function pickCoverFromImages(imgs: ImageRef[] | undefined, fallback?: any): string | null {
//   const arr = Array.isArray(imgs) ? imgs : [];
//   const primary = arr.find((im) => !!im?.primary && !!im?.file)?.file ?? null;
//   const first = arr.find((im) => !!im?.file)?.file ?? null;
//   const rawCover = typeof fallback?.cover === 'string' ? fallback.cover : null;
//   return primary || first || rawCover || null;
// }

// function normalizeItem(raw: any): MyItem {
//   if (!raw) throw new Error('Item vacío');

//   const images: ImageRef[] = Array.isArray(raw?.images)
//     ? raw.images.map((im: any) => ({
//         id: Number(im?.id ?? 0),
//         file: im?.file ?? im?.file_path ?? null,
//         primary: !!(im?.primary ?? im?.is_primary),
//       }))
//     : [];

//   // ✅ NUEVO: ordena para que primary salga primero (y luego el resto)
//   images.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));

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
//     visibility: 'public',
//   };
// }

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

// function buildTouchedPayload(cleaned: ItemDraft, touched: Set<keyof ItemDraft>): Partial<ItemDraft> {
//   const payload: Partial<ItemDraft> = {};
//   touched.forEach((k) => {
//     (payload as any)[k] = cleaned[k];
//   });
//   return payload;
// }

// function normalizeTagNames(names: string[]): string[] {
//   const seen = new Set<string>();
//   const out: string[] = [];
//   for (const raw of names) {
//     const n = String(raw ?? '').trim();
//     if (!n) continue;
//     const key = n.toLowerCase();
//     if (seen.has(key)) continue;
//     seen.add(key);
//     out.push(n);
//   }
//   return out;
// }

// function errorMessage(err: any, fallback: string) {
//   return err?.error?.message ?? (typeof err?.message === 'string' ? err.message : null) ?? fallback;
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

//   isEditing = signal(false);
//   draft = signal<ItemDraft | null>(null);

//   currentId = signal<number | null>(null);

//   isBrowser = false;

//   private touched = new Set<keyof ItemDraft>();

//   /** ===== TAGS (solo renombrar texto) ===== */
//   draftTagNames: string[] = [];
//   newTagName = '';
//   private tagsTouched = false;

//   @ViewChildren('tagInput') tagInputs!: QueryList<ElementRef<HTMLInputElement>>;
//   @ViewChild('newTagInput') newTagInput?: ElementRef<HTMLInputElement>;

//   // ✅ NUEVO: trackBy para imágenes (para ngFor)
//   trackByImgId = (_: number, im: ImageRef) => im?.id ?? im?.file ?? _;

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
//         visibility: 'public',
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

//   focusNewTagInput() {
//     if (!this.isBrowser) return;
//     setTimeout(() => this.newTagInput?.nativeElement?.focus(), 0);
//   }

//   focusTag(index: number) {
//     if (!this.isBrowser) return;
//     setTimeout(() => {
//       const el = this.tagInputs?.toArray?.()[index]?.nativeElement;
//       if (!el) return;
//       el.focus();
//       el.select();
//     }, 0);
//   }

//   private buildHeaders(): HttpHeaders {
//     if (!this.isBrowser) return new HttpHeaders();

//     const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
//     return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
//   }

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
//               .get<ItemTag[]>(`${API_BASE}/items/${id}/tags`, { headers: this.buildHeaders() })
//               .pipe(catchError(() => of((base.tags as ItemTag[]) ?? []))),
//             attrs: this.http
//               .get<AttributeValue[]>(`${API_BASE}/items/${id}/attributes`, { headers: this.buildHeaders() })
//               .pipe(catchError(() => of((base.attributes as AttributeValue[]) ?? []))),
//           });
//         })
//       )
//       .subscribe({
//         next: ({ base, tags, attrs }) => {
//           const merged = { ...base, tags, attributes: attrs };

//           // ✅ NUEVO: si por alguna razón cover vino null pero hay imágenes, setearla
//           if (!merged.cover) {
//             merged.cover = pickCoverFromImages(merged.images, merged);
//           }

//           this.item.set(merged);

//           this.draftTagNames = normalizeTagNames(Array.isArray(tags) ? tags.map((t) => t.name) : []);
//           this.tagsTouched = false;

//           if (!this.isEditing()) this.draft.set(toDraft(merged));

//           this.touched.clear();
//           this.busy.set(false);
//         },
//         error: (err) => {
//           this.error.set(errorMessage(err, 'No se pudo cargar el item.'));
//           this.busy.set(false);
//         },
//       });
//   }

//   startEdit() {
//     const it = this.item();
//     if (!it) return;

//     this.draft.set(toDraft(it));
//     this.isEditing.set(true);
//     this.error.set(null);

//     this.touched.clear();

//     this.draftTagNames = normalizeTagNames(Array.isArray(it.tags) ? it.tags.map((t) => t.name) : []);
//     this.tagsTouched = false;
//     this.newTagName = '';

//     this.focusNewTagInput();
//   }

//   cancelEdit() {
//     const it = this.item();
//     if (it) this.draft.set(toDraft(it));
//     this.isEditing.set(false);
//     this.error.set(null);

//     this.touched.clear();
//     this.tagsTouched = false;

//     this.draftTagNames = normalizeTagNames(
//       Array.isArray(it?.tags) ? (it!.tags as ItemTag[]).map((t) => t.name) : []
//     );
//     this.newTagName = '';
//   }

//   patchDraft(patch: Partial<ItemDraft>) {
//     const d = this.draft();
//     if (!d) return;

//     (Object.keys(patch) as (keyof ItemDraft)[]).forEach((k) => this.touched.add(k));
//     this.draft.set({ ...d, ...patch });
//   }

//   /** ===== TAGS helpers (solo renombrar) ===== */

//   addNewTagFromInput() {
//     const name = (this.newTagName ?? '').trim();
//     if (!name) return;

//     const before = this.draftTagNames;
//     const after = normalizeTagNames([...before, name]);

//     if (after.length !== before.length) {
//       this.draftTagNames = after;
//       this.tagsTouched = true;
//     }

//     this.newTagName = '';
//     this.focusNewTagInput();
//   }

//   trackByIndex(index: number) {
//     return index;
//   }

//   renameDraftTagAt(index: number, newName: string) {
//     if (index < 0 || index >= this.draftTagNames.length) return;

//     const arr = [...this.draftTagNames];
//     arr[index] = newName; // ✅ NO normalizar aquí
//     this.draftTagNames = arr;

//     this.tagsTouched = true;
//   }

//   removeDraftTagAt(index: number) {
//     const arr = [...this.draftTagNames];
//     if (index < 0 || index >= arr.length) return;

//     arr.splice(index, 1);
//     this.draftTagNames = arr;
//     this.tagsTouched = true;

//     const next = Math.min(index, this.draftTagNames.length - 1);
//     if (next >= 0) this.focusTag(next);
//     else this.focusNewTagInput();
//   }

//   /** ✅ SOLO RENOMBRAR TAGS EXISTENTES: PUT /tags/:id */
//   private renameTagsOnly(itemId: number) {
//     const it = this.item();
//     const currentTags = Array.isArray(it?.tags) ? (it!.tags as ItemTag[]) : [];
//     const newNames = normalizeTagNames(this.draftTagNames);

//     if (newNames.length !== currentTags.length) {
//       throw new Error('Solo se permite renombrar tags existentes. No se puede agregar/eliminar tags aquí.');
//     }

//     const calls = currentTags.map((t, idx) => {
//       const newName = String(newNames[idx] ?? '').trim();
//       if (!newName || newName === t.name) return of(null);

//       return this.http.put<ItemTag>(`${API_BASE}/tags/${t.id}`, { name: newName }, { headers: this.buildHeaders() });
//     });

//     return forkJoin(calls); // (ItemTag | null)[]
//   }

//   saveEdit() {
//     const id = this.currentId();
//     const it = this.item();
//     const d = this.draft();
//     if (!id || !it || !d) return;

//     const cleaned = cleanDraft(d);
//     cleaned.visibility = 'public';
//     this.touched.add('visibility');

//     const effectiveTitle = (this.touched.has('title') ? cleaned.title : it.title) ?? '';
//     if (!effectiveTitle.trim()) {
//       this.error.set('El título no puede estar vacío.');
//       return;
//     }

//     this.saving.set(true);
//     this.error.set(null);

//     const payload = buildTouchedPayload(cleaned, this.touched);

//     const saveItem$ =
//       Object.keys(payload).length > 0
//         ? this.http.put(`${API_BASE}/items/${id}`, payload, { headers: this.buildHeaders() })
//         : of(null);

//     const saveTags$ = this.tagsTouched ? this.renameTagsOnly(id) : of(null);

//     forkJoin({ itemRes: saveItem$, tagsRes: saveTags$ }).subscribe({
//       next: ({ itemRes, tagsRes }) => {
//         const baseUpdated = itemRes ? normalizeItem(itemRes) : it;

//         let finalTags: ItemTag[] | undefined = it.tags;

//         if (this.tagsTouched) {
//           if (!Array.isArray(tagsRes)) {
//             throw new Error('No se pudo guardar tags (respuesta inválida).');
//           }

//           const updatedById = new Map<number, ItemTag>();
//           for (const r of tagsRes as Array<ItemTag | null>) {
//             if (r && typeof r.id === 'number') updatedById.set(r.id, r);
//           }

//           finalTags = (Array.isArray(it.tags) ? it.tags : []).map((t) => updatedById.get(t.id) ?? t);
//         }

//         const finalItem: MyItem = {
//           ...it,
//           ...baseUpdated,
//           tags: finalTags,
//           attributes: it.attributes,
//           images: it.images, // ✅ se mantiene (no se edita aquí)
//           cover: it.cover ?? baseUpdated.cover,
//         };

//         (Object.keys(payload) as (keyof ItemDraft)[]).forEach((k) => {
//           (finalItem as any)[k] = (payload as any)[k];
//         });

//         this.item.set(finalItem);
//         this.draft.set(toDraft(finalItem));
//         this.isEditing.set(false);

//         this.touched.clear();
//         this.tagsTouched = false;
//         this.newTagName = '';

//         this.draftTagNames = normalizeTagNames(Array.isArray(finalTags) ? finalTags.map((t) => t.name) : []);

//         this.saving.set(false);
//       },
//       error: (err) => {
//         this.error.set(errorMessage(err, 'No se pudo guardar los cambios.'));
//         this.saving.set(false);
//       },
//     });
//   }

//   // ✅ esto es lo que usa tu HTML para cambiar la imagen principal (cover)
//   setActiveImage(img: ImageRef) {
//     const current = this.item();
//     if (!current || !img?.file) return;
//     this.item.set({ ...current, cover: img.file });
//   }

//   goEdit(id: number) {
//     this.router.navigate(['/items/upload'], { queryParams: { id } });
//   }

//   goUploadNewFrom(id: number) {
//     this.router.navigate(['/items/upload'], { queryParams: { from: id } });
//   }

//   confirmDelete(id: number) {
//     if (!this.isBrowser) return;
//     const ok = window.confirm('¿Estás segura de eliminar esta pieza? Esta acción no se puede deshacer.');
//     if (!ok) return;
//     this.deleteItem(id);
//   }

//   private deleteItem(id: number) {
//     this.busy.set(true);
//     this.error.set(null);

//     this.http.delete(`${API_BASE}/items/${id}`, { headers: this.buildHeaders() }).subscribe({
//       next: () => {
//         this.busy.set(false);
//         this.router.navigate(['/items/mine']);
//       },
//       error: (err) => {
//         this.error.set(errorMessage(err, 'No se pudo eliminar la pieza.'));
//         this.busy.set(false);
//       },
//     });
//   }

//   selectAll(ev: Event) {
//     const el = ev.target as HTMLInputElement | null;
//     if (!el) return;
//     setTimeout(() => {
//       el.select();
//     }, 0);
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

  // ✅ ordena para que primary salga primero (y luego el resto)
  images.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));

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
    visibility: 'public',
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

  // trackBy para imágenes
  trackByImgId = (_: number, im: ImageRef) => im?.id ?? im?.file ?? _;

  /** ===== GALERÍA / CARRUSEL ===== */
  activeImageIndex = 0;

  getGalleryUrls(it: MyItem | null): string[] {
    if (!it) return [];
    const urls: string[] = [];

    if (it.cover) urls.push(it.cover);

    if (Array.isArray(it.images)) {
      for (const im of it.images) {
        if (im?.file) urls.push(im.file);
      }
    }

    return Array.from(new Set(urls));
  }

  goToImage(i: number) {
    this.activeImageIndex = i;

    // sincroniza cover con la imagen activa (para consistencia con UI)
    const current = this.item();
    const urls = this.getGalleryUrls(current);
    if (current && urls[i]) this.item.set({ ...current, cover: urls[i] });
  }

  prevImage(it: MyItem | null) {
    const urls = this.getGalleryUrls(it);
    if (urls.length <= 1) return;

    this.activeImageIndex = (this.activeImageIndex - 1 + urls.length) % urls.length;

    const current = this.item();
    if (current) this.item.set({ ...current, cover: urls[this.activeImageIndex] });
  }

  nextImage(it: MyItem | null) {
    const urls = this.getGalleryUrls(it);
    if (urls.length <= 1) return;

    this.activeImageIndex = (this.activeImageIndex + 1) % urls.length;

    const current = this.item();
    if (current) this.item.set({ ...current, cover: urls[this.activeImageIndex] });
  }

  // si quieres seguir usando setActiveImage en otros lados
  setActiveImage(img: ImageRef) {
    const current = this.item();
    if (!current || !img?.file) return;

    const urls = this.getGalleryUrls(current);
    const idx = urls.indexOf(img.file);

    this.item.set({ ...current, cover: img.file });
    if (idx >= 0) this.activeImageIndex = idx;
  }

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
        visibility: 'public',
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

          // si cover vino null pero hay imágenes, setearla
          if (!merged.cover) {
            merged.cover = pickCoverFromImages(merged.images, merged);
          }

          this.item.set(merged);

          // ✅ reset carrusel al cargar item nuevo
          this.activeImageIndex = 0;

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

  renameDraftTagAt(index: number, newName: string) {
    if (index < 0 || index >= this.draftTagNames.length) return;

    const arr = [...this.draftTagNames];
    arr[index] = newName; // NO normalizar aquí
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

  /** SOLO RENOMBRAR TAGS EXISTENTES: PUT /tags/:id */
  private renameTagsOnly(itemId: number) {
    const it = this.item();
    const currentTags = Array.isArray(it?.tags) ? (it!.tags as ItemTag[]) : [];
    const newNames = normalizeTagNames(this.draftTagNames);

    if (newNames.length !== currentTags.length) {
      throw new Error('Solo se permite renombrar tags existentes. No se puede agregar/eliminar tags aquí.');
    }

    const calls = currentTags.map((t, idx) => {
      const newName = String(newNames[idx] ?? '').trim();
      if (!newName || newName === t.name) return of(null);

      return this.http.put<ItemTag>(`${API_BASE}/tags/${t.id}`, { name: newName }, { headers: this.buildHeaders() });
    });

    return forkJoin(calls); // (ItemTag | null)[]
  }

  saveEdit() {
    const id = this.currentId();
    const it = this.item();
    const d = this.draft();
    if (!id || !it || !d) return;

    const cleaned = cleanDraft(d);
    cleaned.visibility = 'public';
    this.touched.add('visibility');

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

    const saveTags$ = this.tagsTouched ? this.renameTagsOnly(id) : of(null);

    forkJoin({ itemRes: saveItem$, tagsRes: saveTags$ }).subscribe({
      next: ({ itemRes, tagsRes }) => {
        const baseUpdated = itemRes ? normalizeItem(itemRes) : it;

        let finalTags: ItemTag[] | undefined = it.tags;

        if (this.tagsTouched) {
          if (!Array.isArray(tagsRes)) {
            throw new Error('No se pudo guardar tags (respuesta inválida).');
          }

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
    setTimeout(() => {
      el.select();
    }, 0);
  }
}
