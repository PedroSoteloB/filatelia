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
  attributes?: any[]; // lo trae /items/:id/attributes
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

/** ===== NUEVO: defs + draft attrs ===== **/
type AttrDef = {
  id: number;
  name: string;
  attrType: 'text' | 'number' | 'date' | 'list' | string;
  options?: string[];
};

type DraftAttr = {
  attributeId: number;
  name: string;
  attrType: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: string | null; // YYYY-MM-DD
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

  /** ===== TAGS (agregar/quitar/renombrar) ===== */
  draftTags: ItemTag[] = []; // incluye nuevos con id=0
  newTagName = '';
  private tagsChanged = false;
  private originalTagsById = new Map<number, string>();

  @ViewChildren('tagInput') tagInputs!: QueryList<ElementRef<HTMLInputElement>>;
  @ViewChild('newTagInput') newTagInput?: ElementRef<HTMLInputElement>;

  /** ===== ATTRS (agregar/quitar/editar valores) ===== */
  attrDefs: AttrDef[] = [];
  draftAttrs: DraftAttr[] = [];
  private attrsChanged = false;
  private originalAttrIds = new Set<number>();

  newAttrDefId: number | null = null;
  newAttrValueText = '';
  newAttrValueNumber: number | null = null;
  newAttrValueDate: string | null = null;

  /** ===== GALERÍA / CARRUSEL ===== */
  activeImageIndex = 0;
  trackByImgId = (_: number, im: ImageRef) => im?.id ?? im?.file ?? _;
  trackByIndex(index: number) {
    return index;
  }

  getGalleryUrls(it: MyItem | null): string[] {
    if (!it) return [];
    const urls: string[] = [];
    if (Array.isArray(it.images)) {
      for (const im of it.images) {
        if (im?.file) urls.push(im.file);
      }
    }
    const unique = Array.from(new Set(urls));
    if (it.cover && !unique.includes(it.cover)) unique.unshift(it.cover);
    return unique;
  }

  goToImage(i: number) {
    this.activeImageIndex = i;
  }

  prevImage(it: MyItem | null) {
    const urls = this.getGalleryUrls(it);
    if (urls.length <= 1) return;
    this.activeImageIndex = (this.activeImageIndex - 1 + urls.length) % urls.length;
  }

  nextImage(it: MyItem | null) {
    const urls = this.getGalleryUrls(it);
    if (urls.length <= 1) return;
    this.activeImageIndex = (this.activeImageIndex + 1) % urls.length;
  }

  setActiveImage(img: ImageRef) {
    const current = this.item();
    if (!current || !img?.file) return;
    const urls = this.getGalleryUrls(current);
    const idx = urls.indexOf(img.file);
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

  private mapAttrsFromApi(rows: any[]): DraftAttr[] {
    const arr = Array.isArray(rows) ? rows : [];
    return arr.map((a: any) => ({
      attributeId: Number(a.attributeId ?? a.definitionId ?? 0),
      name: String(a.name ?? ''),
      attrType: String(a.attrType ?? 'text'),
      valueText: a.valueText ?? (typeof a.value === 'string' ? a.value : null),
      valueNumber: Number.isFinite(Number(a.valueNumber)) ? Number(a.valueNumber) : null,
      valueDate: a.valueDate ?? null,
    }));
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
              .get<any[]>(`${API_BASE}/items/${id}/attributes`, { headers: this.buildHeaders() })
              .pipe(catchError(() => of((base.attributes as any[]) ?? []))),
          });
        })
      )
      .subscribe({
        next: ({ base, tags, attrs }) => {
          const merged = { ...base, tags, attributes: attrs };

          if (!merged.cover) {
            merged.cover = pickCoverFromImages(merged.images, merged);
          }

          this.item.set(merged);
          this.activeImageIndex = 0;

          // TAGS
          this.draftTags = Array.isArray(tags) ? tags.map((t) => ({ id: Number(t.id), name: String(t.name) })) : [];
          this.tagsChanged = false;
          this.originalTagsById = new Map(this.draftTags.map((t) => [t.id, t.name]));

          // ATTRS
          this.draftAttrs = this.mapAttrsFromApi(attrs);
          this.attrsChanged = false;
          this.originalAttrIds = new Set(this.draftAttrs.map((x) => x.attributeId));

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

    // TAGS
    this.draftTags = Array.isArray(it.tags)
      ? it.tags.map((t) => ({ id: Number(t.id), name: String(t.name) }))
      : [];
    this.originalTagsById = new Map(this.draftTags.map((t) => [t.id, t.name]));
    this.tagsChanged = false;
    this.newTagName = '';

    // ATTRS (si ya están cargados)
    this.draftAttrs = this.mapAttrsFromApi(Array.isArray(it.attributes) ? (it.attributes as any[]) : []);
    this.originalAttrIds = new Set(this.draftAttrs.map((x) => x.attributeId));
    this.attrsChanged = false;

    // cargar definiciones para selector
    this.http
      .get<AttrDef[]>(`${API_BASE}/attributes`, { headers: this.buildHeaders() })
      .pipe(catchError(() => of([] as AttrDef[])))
      .subscribe((defs) => (this.attrDefs = Array.isArray(defs) ? defs : []));

    this.focusNewTagInput();
  }

  cancelEdit() {
    const it = this.item();
    if (it) this.draft.set(toDraft(it));
    this.isEditing.set(false);
    this.error.set(null);

    this.touched.clear();

    // TAGS
    this.draftTags = Array.isArray(it?.tags)
      ? (it!.tags as ItemTag[]).map((t) => ({ id: Number(t.id), name: String(t.name) }))
      : [];
    this.originalTagsById = new Map(this.draftTags.map((t) => [t.id, t.name]));
    this.tagsChanged = false;
    this.newTagName = '';

    // ATTRS
    this.draftAttrs = this.mapAttrsFromApi(Array.isArray(it?.attributes) ? (it!.attributes as any[]) : []);
    this.originalAttrIds = new Set(this.draftAttrs.map((x) => x.attributeId));
    this.attrsChanged = false;

    // new attr drafts
    this.newAttrDefId = null;
    this.newAttrValueText = '';
    this.newAttrValueNumber = null;
    this.newAttrValueDate = null;
  }

  patchDraft(patch: Partial<ItemDraft>) {
    const d = this.draft();
    if (!d) return;

    (Object.keys(patch) as (keyof ItemDraft)[]).forEach((k) => this.touched.add(k));
    this.draft.set({ ...d, ...patch });
  }

  /** ===== TAGS UI ===== */
  addNewTagFromInput() {
    const name = String(this.newTagName ?? '').trim();
    if (!name) return;

    const key = name.toLowerCase();
    const exists = this.draftTags.some((t) => String(t.name).trim().toLowerCase() === key);

    if (!exists) {
      this.draftTags = [...this.draftTags, { id: 0, name }];
      this.tagsChanged = true;
    }

    this.newTagName = '';
    this.focusNewTagInput();
  }

  renameDraftTagAt(index: number, newName: string) {
    if (index < 0 || index >= this.draftTags.length) return;
    const arr = [...this.draftTags];
    arr[index] = { ...arr[index], name: newName };
    this.draftTags = arr;
    this.tagsChanged = true;
  }

  removeDraftTagAt(index: number) {
    if (index < 0 || index >= this.draftTags.length) return;
    const arr = [...this.draftTags];
    arr.splice(index, 1);
    this.draftTags = arr;
    this.tagsChanged = true;

    const next = Math.min(index, this.draftTags.length - 1);
    if (next >= 0) this.focusTag(next);
    else this.focusNewTagInput();
  }

  private saveTagsOps(itemId: number) {
    const it = this.item();
    const original = Array.isArray(it?.tags) ? (it!.tags as ItemTag[]) : [];

    const byNameLower = new Set<string>();
    const draftFinal: ItemTag[] = [];
    for (const t of this.draftTags) {
      const nm = String(t.name ?? '').trim();
      if (!nm) continue;
      const k = nm.toLowerCase();
      if (byNameLower.has(k)) continue;
      byNameLower.add(k);
      draftFinal.push({ id: Number(t.id ?? 0), name: nm });
    }

    // renames (solo tags existentes)
    const renameCalls = draftFinal
      .filter((t) => t.id > 0)
      .map((t) => {
        const old = this.originalTagsById.get(t.id) ?? '';
        const nn = String(t.name ?? '').trim();
        if (!nn || nn === old) return of(null);
        return this.http.put(`${API_BASE}/tags/${t.id}`, { name: nn }, { headers: this.buildHeaders() });
      });

    // deletes (originales que no están)
    const draftExistingIds = new Set(draftFinal.filter((t) => t.id > 0).map((t) => t.id));
    const deleteCalls = original
      .filter((t) => !draftExistingIds.has(Number(t.id)))
      .map((t) => this.http.delete(`${API_BASE}/items/${itemId}/tags/${t.id}`, { headers: this.buildHeaders() }));

    // adds (nuevos) -> NUEVO ENDPOINT
    const newNames = normalizeTagNames(draftFinal.filter((t) => t.id === 0).map((t) => t.name));
    const addCall =
      newNames.length > 0
        ? this.http.post(`${API_BASE}/items/${itemId}/tags/upsert`, { tagNames: newNames }, { headers: this.buildHeaders() })
        : of(null);

    return forkJoin([...renameCalls, ...deleteCalls, addCall]);
  }

  /** ===== ATTRS UI ===== */
  setNewAttrDef(id: any) {
    const n = Number(id);
    this.newAttrDefId = Number.isFinite(n) ? n : null;
    this.newAttrValueText = '';
    this.newAttrValueNumber = null;
    this.newAttrValueDate = null;
  }

  // addOrUpdateDraftAttrFromNew() {
  //   if (!this.newAttrDefId) return;

  //   const def = this.attrDefs.find((d) => Number(d.id) === Number(this.newAttrDefId));
  //   if (!def) return;

  //   const attrType = String(def.attrType ?? 'text');

  //   const next: DraftAttr = {
  //     attributeId: def.id,
  //     name: def.name,
  //     attrType,
  //     valueText: null,
  //     valueNumber: null,
  //     valueDate: null,
  //   };

  //   if (attrType === 'number') {
  //     next.valueNumber = Number.isFinite(Number(this.newAttrValueNumber)) ? Number(this.newAttrValueNumber) : null;
  //   } else if (attrType === 'date') {
  //     next.valueDate = this.newAttrValueDate ? String(this.newAttrValueDate) : null;
  //   } else {
  //     next.valueText = String(this.newAttrValueText ?? '').trim() || null;
  //   }

  //   const idx = this.draftAttrs.findIndex((a) => Number(a.attributeId) === Number(def.id));
  //   if (idx >= 0) {
  //     const arr = [...this.draftAttrs];
  //     arr[idx] = { ...arr[idx], ...next };
  //     this.draftAttrs = arr;
  //   } else {
  //     this.draftAttrs = [...this.draftAttrs, next];
  //   }

  //   this.attrsChanged = true;

  //   this.newAttrDefId = null;
  //   this.newAttrValueText = '';
  //   this.newAttrValueNumber = null;
  //   this.newAttrValueDate = null;
  // }

  addOrUpdateDraftAttrFromNew() {
    if (!this.newAttrDefId) return;
  
    const def = this.attrDefs.find((d) => Number(d.id) === Number(this.newAttrDefId));
    if (!def) return;
  
    // ✅ VALIDACIÓN: si ya existe ese atributo, no permitimos duplicarlo
    const exists = this.draftAttrs.some((a) => Number(a.attributeId) === Number(def.id));
    if (exists) {
      this.error.set(`El atributo "${def.name}" ya existe. Modifica el valor en la tarjeta de arriba (no se puede duplicar).`);
      return;
    }
  
    const attrType = String(def.attrType ?? 'text');
  
    const next: DraftAttr = {
      attributeId: def.id,
      name: def.name,
      attrType,
      valueText: null,
      valueNumber: null,
      valueDate: null,
    };
  
    if (attrType === 'number') {
      next.valueNumber = Number.isFinite(Number(this.newAttrValueNumber)) ? Number(this.newAttrValueNumber) : null;
    } else if (attrType === 'date') {
      next.valueDate = this.newAttrValueDate ? String(this.newAttrValueDate) : null;
    } else {
      next.valueText = String(this.newAttrValueText ?? '').trim() || null;
    }
  
    // ✅ ADD ONLY (en UI): solo agregamos si no existe (ya validamos arriba)
    this.draftAttrs = [...this.draftAttrs, next];
    this.attrsChanged = true;
  
    // limpiar drafts
    this.newAttrDefId = null;
    this.newAttrValueText = '';
    this.newAttrValueNumber = null;
    this.newAttrValueDate = null;
  }
  

  updateDraftAttrValue(i: number, val: any) {
    if (i < 0 || i >= this.draftAttrs.length) return;
    const a = this.draftAttrs[i];
    const arr = [...this.draftAttrs];

    if (a.attrType === 'number') {
      arr[i] = { ...a, valueNumber: Number.isFinite(Number(val)) ? Number(val) : null };
    } else if (a.attrType === 'date') {
      arr[i] = { ...a, valueDate: val ? String(val) : null };
    } else {
      arr[i] = { ...a, valueText: String(val ?? '').trim() || null };
    }

    this.draftAttrs = arr;
    this.attrsChanged = true;
  }

  removeDraftAttrAt(i: number) {
    if (i < 0 || i >= this.draftAttrs.length) return;
    const arr = [...this.draftAttrs];
    arr.splice(i, 1);
    this.draftAttrs = arr;
    this.attrsChanged = true;
  }

  private saveAttrsOps(itemId: number) {
    const nowIds = new Set(this.draftAttrs.map((a) => Number(a.attributeId)));
    const removed = [...this.originalAttrIds].filter((id) => !nowIds.has(Number(id)));

    const deleteCalls = removed.map((id) =>
      this.http.delete(`${API_BASE}/items/${itemId}/attributes/${id}`, { headers: this.buildHeaders() })
    );

    const upsertCall =
      this.draftAttrs.length > 0
        ? this.http.post(
            `${API_BASE}/items/${itemId}/attributes/upsert`,
            {
                
              attributes: this.draftAttrs.map((a) => ({
                attributeId: Number(a.attributeId) > 0 ? Number(a.attributeId) : null,
                attributeName: String(a.name ?? '').trim(), // <-- SIEMPRE
                attrType: String(a.attrType ?? 'text'),
                valueText: a.valueText ?? null,
                valueNumber: a.valueNumber ?? null,
                valueDate: a.valueDate ?? null,
              })),
              
            },
            { headers: this.buildHeaders() }
          )
        : of(null);

    return forkJoin([...deleteCalls, upsertCall]);
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

    const saveTags$ = this.tagsChanged ? this.saveTagsOps(id) : of(null);
    const saveAttrs$ = this.attrsChanged ? this.saveAttrsOps(id) : of(null);

    forkJoin({ itemRes: saveItem$, tagsRes: saveTags$, attrsRes: saveAttrs$ }).subscribe({
      next: () => {
        this.isEditing.set(false);

        this.touched.clear();
        this.tagsChanged = false;
        this.attrsChanged = false;
        this.newTagName = '';

        this.newAttrDefId = null;
        this.newAttrValueText = '';
        this.newAttrValueNumber = null;
        this.newAttrValueDate = null;

        this.fetchItem(id);
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
    setTimeout(() => el.select(), 0);
  }

  getAttrDefById(id: number | null) {
    if (!id) return null;
    return this.attrDefs.find((d) => d.id === id) ?? null;
  }
}
