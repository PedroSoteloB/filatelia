// import { Component, inject, signal, OnInit } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ActivatedRoute, Router } from '@angular/router';
// import { HttpClient, HttpHeaders } from '@angular/common/http';
// import { firstValueFrom } from 'rxjs';
// import { FormsModule } from '@angular/forms';

// // 👇 IMPORTA environment (ajusta la ruta si hace falta con Ctrl+. en VSCode)
// import { environment } from '../../../../core/environments/environment.prod';
// // 👇 IMPORTA ApiService para los POST
// import { ApiService } from '../../../../core/services/api.service';

// // Base del backend (Azure)
// const API_BASE = environment.apiBaseUrl;

// type CollectionItemRow = {
//   id: number;
//   title: string;
//   country?: string | null;
//   issueYear?: number | null;
//   cover?: string | null;
// };

// type SubFilter = {
//   q?: string;
//   country?: string;
//   yearFrom?: number;
//   yearTo?: number;
//   tagNames?: string[];
//   tagsMode?: 'OR' | 'AND';
//   attrs?: any[];
// };

// @Component({
//   selector: 'app-collection-detail',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './collection-detail.component.html',
//   styleUrls: ['./collection-detail.component.scss'],
//   host: { class: 'collection-detail-page' }
// })
// export class CollectionDetailComponent implements OnInit {
//   private route  = inject(ActivatedRoute);
//   private http   = inject(HttpClient);   // GET con headers
//   private router = inject(Router);
//   private api    = inject(ApiService);   // POST centralizados

//   busy = signal<boolean>(false);
//   error = signal<string | null>(null);

//   collectionId = signal<number | null>(null);
//   items = signal<CollectionItemRow[]>([]);

//   // ---- Sub-búsqueda / selección ----
//   form: SubFilter = {
//     q: '',
//     country: '',
//     yearFrom: undefined,
//     yearTo: undefined,
//     tagNames: [],
//     tagsMode: 'OR',
//     attrs: []
//   };
//   tagsComma = '';
//   attrsJson = '';
//   selectedIds = new Set<number>();
//   coverCandidateId: number | null = null;

//   // 👇 historia opcional de la colección (se manda al back como "history")
//   historyNote: string = '';

//   // Para saber si estamos viendo base o resultado de sub-búsqueda
//   private viewingSub = false;

//   async ngOnInit() {
//     const rawId = this.route.snapshot.paramMap.get('id');
//     const idNum = Number(rawId);
//     if (!Number.isFinite(idNum)) {
//       this.error.set('ID de colección inválido');
//       return;
//     }
//     this.collectionId.set(idNum);
//     await this.loadItems(idNum); // base (colección)
//   }

//   // ====== Auth headers ======
//   private authHeaders(): HttpHeaders {
//     const token =
//       localStorage.getItem('accessToken') ||
//       sessionStorage.getItem('accessToken') ||
//       '';
//     return token
//       ? new HttpHeaders({ Authorization: `Bearer ${token}` })
//       : new HttpHeaders();
//   }

//   // --------- Carga base (sin filtros extra) ----------
//   async loadItems(id: number) {
//     try {
//       this.busy.set(true);
//       this.error.set(null);
//       const rows = await firstValueFrom(
//         this.http.get<CollectionItemRow[]>(
//           `${API_BASE}/collections/${id}/items`,
//           { headers: this.authHeaders() }
//         )
//       );
//       this.items.set(rows || []);
//       this.viewingSub = false;
//       this.selectedIds.clear();
//       this.coverCandidateId = null;
//     } catch (e: any) {
//       this.error.set(
//         e?.error?.message ||
//           e?.message ||
//           'No se pudieron cargar los ítems de la colección'
//       );
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   async reloadBase() {
//     const id = this.collectionId();
//     if (id) await this.loadItems(id);
//   }

//   // --------- Sub-búsqueda dentro de la colección ----------
//   async runSubSearch() {
//     try {
//       const id = this.collectionId();
//       if (!id) return;
//       this.busy.set(true);
//       this.error.set(null);

//       // armar filtros desde UI
//       const f: SubFilter = {
//         q: this.form.q?.trim() || undefined,
//         country: this.form.country?.trim() || undefined,
//         yearFrom: this.form.yearFrom ? Number(this.form.yearFrom) : undefined,
//         yearTo: this.form.yearTo ? Number(this.form.yearTo) : undefined,
//         tagNames: this.tagsComma
//           .split(',')
//           .map((s) => s.trim())
//           .filter(Boolean),
//         tagsMode: (this.form.tagsMode || 'OR') as 'OR' | 'AND',
//       };

//       // attrs desde JSON (opcional)
//       if (this.attrsJson?.trim()) {
//         try {
//           f.attrs = JSON.parse(this.attrsJson);
//         } catch {
//           this.error.set('Attrs JSON inválido');
//           return;
//         }
//       }

//       // construir querystring
//       const qs = new URLSearchParams();
//       if (f.q) qs.set('q', f.q);
//       if (f.country) qs.set('country', f.country);
//       if (f.yearFrom != null) qs.set('yearFrom', String(f.yearFrom));
//       if (f.yearTo != null) qs.set('yearTo', String(f.yearTo));
//       if (f.tagNames && f.tagNames.length) {
//         f.tagNames.forEach((t) => qs.append('tagNames', t));
//       }
//       if (f.tagsMode) qs.set('tagsMode', f.tagsMode);
//       if (f.attrs && f.attrs.length) qs.set('attrs', JSON.stringify(f.attrs));
//       qs.set('limit', '25');
//       qs.set('offset', '0');

//       const url =
//         `${API_BASE}/collections/${id}/items/search-sub?` + qs.toString();

//       const rows = await firstValueFrom(
//         this.http.get<CollectionItemRow[]>(url, {
//           headers: this.authHeaders(),
//         })
//       );
//       this.items.set(rows || []);
//       this.viewingSub = true;
//       this.selectedIds.clear();
//       this.coverCandidateId = null;
//     } catch (e: any) {
//       this.error.set(
//         e?.error?.message ||
//           e?.message ||
//           'No se pudo ejecutar la sub-búsqueda'
//       );
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   resetSubSearch() {
//     this.form = {
//       q: '',
//       country: '',
//       yearFrom: undefined,
//       yearTo: undefined,
//       tagNames: [],
//       tagsMode: 'OR',
//       attrs: [],
//     };
//     this.tagsComma = '';
//     this.attrsJson = '';
//     this.selectedIds.clear();
//     this.coverCandidateId = null;
//   }

//   // --------- Selección / portada ----------
//   toggleSelect(id: number, checked?: boolean) {
//     if (checked) this.selectedIds.add(id);
//     else this.selectedIds.delete(id);
//   }

//   setCover(id: number) {
//     this.coverCandidateId = id;
//   }

//   // ======== Helpers: presentación & PPT ========
//   private async findOrCreatePresentation(
//     collectionId: number,
//     titleFallback: string
//   ): Promise<number> {
//     // Buscar si ya existe una presentación para esa colección
//     const presList = await firstValueFrom(
//       this.http.get<any[]>(
//         `${API_BASE}/presentations?limit=100`,
//         { headers: this.authHeaders() }
//       )
//     );
//     const found = (presList || []).find(
//       (p) => Number(p.collection_id) === Number(collectionId)
//     );
//     if (found?.id) return Number(found.id);

//     // Crear si no existe (🔁 ahora usando ApiService.post)
//     const created = await firstValueFrom(
//       this.api.post<any>(
//         '/presentations',
//         {
//           collection_id: collectionId,
//           title: titleFallback || `Presentación de colección #${collectionId}`,
//           description: 'Generada desde UI',
//         },
//         this.authHeaders()
//       )
//     );
//     return Number(created.id);
//   }

//   private async generatePptForPresentation(
//     presId: number,
//     opts?: { maxSlides?: number }
//   ) {
//     // 1) Genera/actualiza el PPT en el backend (ApiService.post)
//     const qs = new URLSearchParams();
//     if (opts?.maxSlides != null) qs.set('maxSlides', String(opts.maxSlides));

//     await firstValueFrom(
//       this.api.post(
//         `/presentations/${presId}/generate-ppt?${qs.toString()}`,
//         {},
//         this.authHeaders()
//       )
//     );

//     // 2) Descarga con HttpClient (con Authorization) y dispara la descarga
//     await this.downloadPpt(presId);
//   }

//   private async downloadPpt(presId: number) {
//     const resp = await firstValueFrom(
//       this.http.get<{
//         presentonUrl: string | null;
//         downloadUrl: string | null;
//         filePath: string | null;
//       }>(`${API_BASE}/presentations/${presId}/ppt`, {
//         headers: this.authHeaders(),
//       })
//     );

//     // 1) Prioridad: Abrir / descargar en Presenton
//     if (resp.presentonUrl) {
//       window.open(resp.presentonUrl, '_blank');
//       return;
//     }

//     // 2) Fallback: URL directa (S3 u otro)
//     if (resp.downloadUrl) {
//       window.open(resp.downloadUrl, '_blank');
//       return;
//     }

//     // 3) Último recurso: nada encontrado
//     alert('No se encontró PPT para esta presentación');
//   }

//   // --------- Crear derivadas ----------
//   async createSnapshot(genPpt = false) {
//     try {
//       const id = this.collectionId();
//       if (!id) return;

//       if (this.selectedIds.size === 0) {
//         this.error.set('Selecciona 10–15 ítems para crear Snapshot.');
//         return;
//       }

//       const baseName = `Subconjunto de ${id} (${this.selectedIds.size} items)`;
//       const name = await this.uniqueCollectionName(baseName);

//       const body = {
//         mode: 'snapshot',
//         name,
//         description: 'Creado desde sub-busqueda',
//         history: this.historyNote?.trim() || null,
//         selectedItemIds: Array.from(this.selectedIds),
//         coverItemId:
//           this.coverCandidateId ?? Array.from(this.selectedIds)[0],
//       };

//       this.busy.set(true);
//       this.error.set(null);

//       const resp = await firstValueFrom(
//         this.api.post<any>(
//           `/collections/${id}/derive`,
//           body,
//           this.authHeaders()
//         )
//       );
//       const childId = Number(resp.id);
//       const presIdFromBack = Number(resp.presentationId || 0);

//       if (genPpt) {
//         const presId =
//           presIdFromBack ||
//           (await this.findOrCreatePresentation(childId, name));
//         await this.generatePptForPresentation(presId, { maxSlides: 15 });
//       }

//       this.router.navigate(['/collections']);
//     } catch (e: any) {
//       if (
//         e?.status === 409 ||
//         /Duplicate entry/i.test(e?.error?.message || '')
//       ) {
//         try {
//           const id = this.collectionId()!;
//           const retryName = await this.uniqueCollectionName(
//             `Subconjunto de  ${id} (${this.selectedIds.size} items)`
//           );
//           const body = {
//             mode: 'snapshot',
//             name: retryName,
//             description: 'Creado desde sub-busqueda',
//             history: this.historyNote?.trim() || null,
//             selectedItemIds: Array.from(this.selectedIds),
//             coverItemId:
//               this.coverCandidateId ?? Array.from(this.selectedIds)[0],
//           };

//           const resp2 = await firstValueFrom(
//             this.api.post<any>(
//               `/collections/${id}/derive`,
//               body,
//               this.authHeaders()
//             )
//           );
//           const childId2 = Number(resp2.id);
//           const presId2 = Number(resp2.presentationId || 0);

//           if (genPpt) {
//             const pid =
//               presId2 ||
//               (await this.findOrCreatePresentation(childId2, retryName));
//             await this.generatePptForPresentation(pid, { maxSlides: 15 });
//           }

//           this.router.navigate(['/collections']);
//           return;
//         } catch {}
//       }

//       this.error.set(
//         e?.error?.message ||
//           e?.message ||
//           'No se pudo crear la colección Snapshot'
//       );
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   async createSmart() {
//     try {
//       const id = this.collectionId();
//       if (!id) return;

//       const extra: any = {};
//       if (this.viewingSub) {
//         extra.q = this.form.q?.trim() || undefined;
//         extra.country = this.form.country?.trim() || undefined;
//         if (this.form.yearFrom != null)
//           extra.yearFrom = Number(this.form.yearFrom);
//         if (this.form.yearTo != null)
//           extra.yearTo = Number(this.form.yearTo);
//         const tagNames = this.tagsComma
//           .split(',')
//           .map((s) => s.trim())
//           .filter(Boolean);
//         if (tagNames.length) extra.tagNames = tagNames;
//         extra.tagsMode = this.form.tagsMode || 'OR';
//         if (this.attrsJson?.trim()) {
//           try {
//             extra.attrs = JSON.parse(this.attrsJson);
//           } catch {
//             this.error.set('Attrs JSON inválido');
//             return;
//           }
//         }
//       }

//       const body = {
//         mode: 'smart',
//         name: `Smart de #${id}`,
//         description: 'Sub-búsqueda persistente',
//         history: this.historyNote?.trim() || null,
//         extraFilter: extra,
//         coverItemId: this.coverCandidateId || null,
//       };

//       this.busy.set(true);
//       this.error.set(null);

//       await firstValueFrom(
//         this.api.post<any>(
//           `/collections/${id}/derive`,
//           body,
//           this.authHeaders()
//         )
//       );
//       this.router.navigate(['/collections']);
//     } catch (e: any) {
//       this.error.set(
//         e?.error?.message ||
//           e?.message ||
//           'No se pudo crear la colección Smart'
//       );
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   // --------- Navegación / meta ----------
//   goBack(): void {
//     this.router.navigateByUrl('/collections');
//   }

//   goItemDetail(itemId: number) {
//     this.router.navigate(['/item', itemId]);
//   }

//   buildMeta(it: CollectionItemRow): string {
//     const parts: string[] = [];
//     if (it.country) parts.push(it.country);
//     if (it.issueYear != null) parts.push(String(it.issueYear));
//     parts.push(`#${it.id}`);
//     return parts.join(' · ');
//   }

//   // Devuelve un nombre único agregando " (2)", " (3)", ... si ya existe
//   private async uniqueCollectionName(base: string): Promise<string> {
//     try {
//       const cols = await firstValueFrom(
//         this.http.get<any[]>(`${API_BASE}/collections`, {
//           headers: this.authHeaders(),
//         })
//       );
//       const existing = new Set<string>(
//         (cols || []).map((c) => String(c.name))
//       );
//       if (!existing.has(base)) return base;

//       let i = 2;
//       let candidate = `${base} (${i})`;
//       while (existing.has(candidate)) {
//         i++;
//         candidate = `${base} (${i})`;
//       }
//       return candidate;
//     } catch {
//       const stamp = new Date()
//         .toISOString()
//         .slice(11, 19)
//         .replace(/:/g, '');
//       return `${base} ${stamp}`;
//     }
//   }
// }
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../core/environments/environment.prod';
import { ApiService } from '../../../../core/services/api.service';

const API_BASE = environment.apiBaseUrl;

type CollectionItemRow = {
  id: number;
  title: string;
  country?: string | null;
  issueYear?: number | null;
  cover?: string | null;
};

type SubFilter = {
  q?: string;
  country?: string;
  yearFrom?: number;
  yearTo?: number;
  tagNames?: string[];
  tagsMode?: 'OR' | 'AND';
  attrs?: any[];
};

// ====== NUEVO: Catálogos para UI tipo /items/search ======
type TagDTO = { id: number; name: string };
type AttrDefDTO = { id: number; name: string; attrType: 'text'|'number'|'date'|'list' };

// ====== NUEVO: Tipos para builder de atributos ======
type AttrFilterBetween = {
  id?: number;
  name?: string;
  op: 'between';
  from: string | number;
  to: string | number;
};
type AttrFilterSingle = {
  id?: number;
  name?: string;
  op?: '=' | 'like';
  value: string | number;
};
type AttrFilter = AttrFilterBetween | AttrFilterSingle;

@Component({
  selector: 'app-collection-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection-detail.component.html',
  styleUrls: ['./collection-detail.component.scss'],
  host: { class: 'collection-detail-page' }
})
export class CollectionDetailComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private http   = inject(HttpClient);
  private router = inject(Router);
  private api    = inject(ApiService);

  busy = signal<boolean>(false);
  error = signal<string | null>(null);

  collectionId = signal<number | null>(null);
  items = signal<CollectionItemRow[]>([]);

  // ✅ NUEVO: catálogos
  countries = signal<string[]>([]);
  allTags = signal<TagDTO[]>([]);
  allAttrDefs = signal<AttrDefDTO[]>([]);

  // ---- Sub-búsqueda / selección ----
  form: SubFilter = {
    q: '',
    country: '',
    yearFrom: undefined,
    yearTo: undefined,
    tagNames: [],
    tagsMode: 'OR',
    attrs: []
  };

  // ❌ YA NO SE USAN (los dejo comentados para que no rompa si aún están en tu HTML)
  // tagsComma = '';
  // attrsJson = '';

  // ✅ NUEVO: Tags igual que búsqueda (search + chips)
  tagSearch = signal<string>('');
  selectedTagNames = signal<string[]>([]);

  filteredTags = computed(() => {
    const term = (this.tagSearch() || '').trim().toLowerCase();
    const tags = this.allTags() || [];
    if (!term) return [];
    const out = tags
      .filter(t => t.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return out.slice(0, 60);
  });

  selectedTags = computed(() => {
    const names = new Set(this.selectedTagNames().map(x => x.toLowerCase()));
    return (this.allTags() || []).filter(t => names.has(t.name.toLowerCase()));
  });

  setTagSearch(v: string) { this.tagSearch.set(v || ''); }

  toggleTagName(name: string) {
    const cur = new Set(this.selectedTagNames());
    if (cur.has(name)) cur.delete(name);
    else cur.add(name);
    this.selectedTagNames.set(Array.from(cur));
  }

  onTagClick(name: string) {
    this.toggleTagName(name);
    this.tagSearch.set('');
  }

  setTagsMode(mode: 'OR'|'AND') {
    this.form.tagsMode = mode;
  }

  // ✅ NUEVO: Atributos igual que búsqueda (builder)
  attrFilters = signal<AttrFilter[]>([]);

  private findAttrName(id: number): string | undefined {
    return this.allAttrDefs().find(x => x.id === id)?.name;
  }

  private makeEqualsFilter(id: number, value: string | number): AttrFilter {
    return { id, name: this.findAttrName(id), op: '=', value };
  }

  private makeLikeFilter(id: number, value: string): AttrFilter {
    return { id, name: this.findAttrName(id), op: 'like', value };
  }

  private makeBetweenFilter(id: number, from: string | number, to: string | number): AttrFilter {
    const fromNum = Number(from);
    const toNum   = Number(to);
    return {
      id,
      name: this.findAttrName(id),
      op: 'between',
      from: Number.isFinite(fromNum) ? fromNum : from,
      to: Number.isFinite(toNum) ? toNum : to
    };
  }

  // lo llama el HTML (botón "Añadir")
  onAddAttrClick(
    attrId: number,
    op: '=' | 'like' | 'between',
    v1?: string,
    vFrom?: string,
    vTo?: string
  ) {
    if (!Number.isFinite(attrId) || attrId <= 0) return;

    if (op === 'between') {
      const fromRaw = (vFrom || '').trim();
      const toRaw   = (vTo || '').trim();
      if (!fromRaw || !toRaw) return;

      const f = this.makeBetweenFilter(attrId, fromRaw, toRaw);
      this.attrFilters.set([...this.attrFilters(), f]);
      return;
    }

    const raw = (v1 || '').trim();
    if (!raw) return;

    if (op === 'like') {
      const f = this.makeLikeFilter(attrId, raw);
      this.attrFilters.set([...this.attrFilters(), f]);
      return;
    }

    const asNum = Number(raw);
    const value: string | number = Number.isFinite(asNum) ? asNum : raw;
    const f = this.makeEqualsFilter(attrId, value);
    this.attrFilters.set([...this.attrFilters(), f]);
  }

  removeAttrFilter(idx: number) {
    const arr = [...this.attrFilters()];
    arr.splice(idx, 1);
    this.attrFilters.set(arr);
  }

  // selección / portada
  selectedIds = new Set<number>();
  coverCandidateId: number | null = null;

  historyNote: string = '';
  private viewingSub = false;

  async ngOnInit() {
    const rawId = this.route.snapshot.paramMap.get('id');
    const idNum = Number(rawId);

    if (!Number.isFinite(idNum)) {
      this.error.set('ID de colección inválido');
      return;
    }

    // ✅ NUEVO: cargar catálogos para UI tipo búsqueda
    await Promise.all([
      this.loadCountries(),
      this.loadTags(),
      this.loadAttrDefs()
    ]);

    this.collectionId.set(idNum);
    await this.loadItems(idNum);
  }

  // ====== Auth headers ======
  private authHeaders(): HttpHeaders {
    const token =
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('accessToken') ||
      '';
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  // =========================
  // ✅ NUEVO: Cargar países/tags/attrs (como /items/search)
  // =========================
  async loadCountries() {
    try {
      // si tu backend no tiene este endpoint, cambia al que uses en búsqueda
      const list = await firstValueFrom(
        this.http.get<string[]>(
          `${API_BASE}/items/countries`,
          { headers: this.authHeaders() }
        )
      );
      this.countries.set(list || []);
    } catch {
      this.countries.set([]);
    }
  }

  async loadTags() {
    try {
      const tags = await firstValueFrom(
        this.http.get<TagDTO[]>(`${API_BASE}/tags`)
      );
      this.allTags.set(tags || []);
    } catch {
      this.allTags.set([]);
    }
  }

  async loadAttrDefs() {
    try {
      const defs = await firstValueFrom(
        this.http.get<AttrDefDTO[]>(`${API_BASE}/attributes`)
      );
      this.allAttrDefs.set(defs || []);
    } catch {
      this.allAttrDefs.set([]);
    }
  }

  // --------- Carga base (sin filtros extra) ----------
  async loadItems(id: number) {
    try {
      this.busy.set(true);
      this.error.set(null);

      const rows = await firstValueFrom(
        this.http.get<CollectionItemRow[]>(
          `${API_BASE}/collections/${id}/items`,
          { headers: this.authHeaders() }
        )
      );

      this.items.set(rows || []);
      this.viewingSub = false;
      this.selectedIds.clear();
      this.coverCandidateId = null;
    } catch (e: any) {
      this.error.set(
        e?.error?.message ||
        e?.message ||
        'No se pudieron cargar los ítems de la colección'
      );
    } finally {
      this.busy.set(false);
    }
  }

  async reloadBase() {
    const id = this.collectionId();
    if (id) await this.loadItems(id);
  }

  // --------- Sub-búsqueda dentro de la colección ----------
  async runSubSearch() {
    try {
      const id = this.collectionId();
      if (!id) return;

      this.busy.set(true);
      this.error.set(null);

      // ✅ AHORA: tagNames y attrs vienen del UI tipo búsqueda
      const tagNames = this.selectedTagNames();
      const attrs = this.attrFilters();

      const f: SubFilter = {
        q: this.form.q?.trim() || undefined,
        country: this.form.country?.trim() || undefined,
        yearFrom: this.form.yearFrom != null ? Number(this.form.yearFrom) : undefined,
        yearTo: this.form.yearTo != null ? Number(this.form.yearTo) : undefined,
        tagNames: tagNames.length ? tagNames : undefined,
        tagsMode: (this.form.tagsMode || 'OR') as 'OR' | 'AND',
        attrs: attrs.length ? attrs : undefined
      };

      // ✅ querystring robusto con HttpParams
      let params = new HttpParams()
        .set('limit', '25')
        .set('offset', '0')
        .set('tagsMode', f.tagsMode || 'OR');

      if (f.q) params = params.set('q', f.q);
      if (f.country) params = params.set('country', f.country);
      if (f.yearFrom != null) params = params.set('yearFrom', String(f.yearFrom));
      if (f.yearTo != null) params = params.set('yearTo', String(f.yearTo));

      if (f.tagNames?.length) {
        f.tagNames.forEach(t => { params = params.append('tagNames', t); });
      }

      if (f.attrs?.length) {
        params = params.set('attrs', JSON.stringify(f.attrs));
      }

      const rows = await firstValueFrom(
        this.http.get<CollectionItemRow[]>(
          `${API_BASE}/collections/${id}/items/search-sub`,
          { headers: this.authHeaders(), params }
        )
      );

      this.items.set(rows || []);
      this.viewingSub = true;
      this.selectedIds.clear();
      this.coverCandidateId = null;
    } catch (e: any) {
      this.error.set(
        e?.error?.message ||
        e?.message ||
        'No se pudo ejecutar la sub-búsqueda'
      );
    } finally {
      this.busy.set(false);
    }
  }

  resetSubSearch() {
    this.form = {
      q: '',
      country: '',
      yearFrom: undefined,
      yearTo: undefined,
      tagNames: [],
      tagsMode: 'OR',
      attrs: [],
    };

    // ✅ reset de nuevos estados
    this.tagSearch.set('');
    this.selectedTagNames.set([]);
    this.attrFilters.set([]);

    this.selectedIds.clear();
    this.coverCandidateId = null;
  }

  // --------- Selección / portada ----------
  toggleSelect(id: number, checked?: boolean) {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  setCover(id: number) {
    this.coverCandidateId = id;
  }

  // ======== Helpers: presentación & PPT ========
  private async findOrCreatePresentation(
    collectionId: number,
    titleFallback: string
  ): Promise<number> {
    const presList = await firstValueFrom(
      this.http.get<any[]>(
        `${API_BASE}/presentations?limit=100`,
        { headers: this.authHeaders() }
      )
    );
    const found = (presList || []).find(
      (p) => Number(p.collection_id) === Number(collectionId)
    );
    if (found?.id) return Number(found.id);

    const created = await firstValueFrom(
      this.api.post<any>(
        '/presentations',
        {
          collection_id: collectionId,
          title: titleFallback || `Presentación de colección #${collectionId}`,
          description: 'Generada desde UI',
        },
        this.authHeaders()
      )
    );
    return Number(created.id);
  }

  private async generatePptForPresentation(
    presId: number,
    opts?: { maxSlides?: number }
  ) {
    const qs = new URLSearchParams();
    if (opts?.maxSlides != null) qs.set('maxSlides', String(opts.maxSlides));

    await firstValueFrom(
      this.api.post(
        `/presentations/${presId}/generate-ppt?${qs.toString()}`,
        {},
        this.authHeaders()
      )
    );

    await this.downloadPpt(presId);
  }

  private async downloadPpt(presId: number) {
    const resp = await firstValueFrom(
      this.http.get<{
        presentonUrl: string | null;
        downloadUrl: string | null;
        filePath: string | null;
      }>(`${API_BASE}/presentations/${presId}/ppt`, {
        headers: this.authHeaders(),
      })
    );

    if (resp.presentonUrl) {
      window.open(resp.presentonUrl, '_blank');
      return;
    }
    if (resp.downloadUrl) {
      window.open(resp.downloadUrl, '_blank');
      return;
    }
    alert('No se encontró PPT para esta presentación');
  }

  // --------- Crear derivadas ----------
  async createSnapshot(genPpt = false) {
    try {
      const id = this.collectionId();
      if (!id) return;

      if (this.selectedIds.size === 0) {
        this.error.set('Selecciona 10–15 ítems para crear Snapshot.');
        return;
      }

      const baseName = `Subconjunto de ${id} (${this.selectedIds.size} items)`;
      const name = await this.uniqueCollectionName(baseName);

      const body = {
        mode: 'snapshot',
        name,
        description: 'Creado desde sub-busqueda',
        history: this.historyNote?.trim() || null,
        selectedItemIds: Array.from(this.selectedIds),
        coverItemId: this.coverCandidateId ?? Array.from(this.selectedIds)[0],
      };

      this.busy.set(true);
      this.error.set(null);

      const resp = await firstValueFrom(
        this.api.post<any>(
          `/collections/${id}/derive`,
          body,
          this.authHeaders()
        )
      );

      const childId = Number(resp.id);
      const presIdFromBack = Number(resp.presentationId || 0);

      if (genPpt) {
        const presId =
          presIdFromBack ||
          (await this.findOrCreatePresentation(childId, name));
        await this.generatePptForPresentation(presId, { maxSlides: 15 });
      }

      this.router.navigate(['/collections']);
    } catch (e: any) {
      if (e?.status === 409 || /Duplicate entry/i.test(e?.error?.message || '')) {
        try {
          const id = this.collectionId()!;
          const retryName = await this.uniqueCollectionName(
            `Subconjunto de  ${id} (${this.selectedIds.size} items)`
          );

          const body = {
            mode: 'snapshot',
            name: retryName,
            description: 'Creado desde sub-busqueda',
            history: this.historyNote?.trim() || null,
            selectedItemIds: Array.from(this.selectedIds),
            coverItemId: this.coverCandidateId ?? Array.from(this.selectedIds)[0],
          };

          const resp2 = await firstValueFrom(
            this.api.post<any>(
              `/collections/${id}/derive`,
              body,
              this.authHeaders()
            )
          );

          const childId2 = Number(resp2.id);
          const presId2 = Number(resp2.presentationId || 0);

          if (genPpt) {
            const pid =
              presId2 ||
              (await this.findOrCreatePresentation(childId2, retryName));
            await this.generatePptForPresentation(pid, { maxSlides: 15 });
          }

          this.router.navigate(['/collections']);
          return;
        } catch {}
      }

      this.error.set(
        e?.error?.message ||
        e?.message ||
        'No se pudo crear la colección Snapshot'
      );
    } finally {
      this.busy.set(false);
    }
  }

  async createSmart() {
    try {
      const id = this.collectionId();
      if (!id) return;

      // ✅ extraFilter ahora se arma igual que búsqueda
      const extra: any = {};
      if (this.viewingSub) {
        extra.q = this.form.q?.trim() || undefined;
        extra.country = this.form.country?.trim() || undefined;
        if (this.form.yearFrom != null) extra.yearFrom = Number(this.form.yearFrom);
        if (this.form.yearTo != null) extra.yearTo = Number(this.form.yearTo);

        const tagNames = this.selectedTagNames();
        if (tagNames.length) extra.tagNames = tagNames;

        extra.tagsMode = this.form.tagsMode || 'OR';

        const attrs = this.attrFilters();
        if (attrs.length) extra.attrs = attrs;
      }

      const body = {
        mode: 'smart',
        name: `Smart de #${id}`,
        description: 'Sub-búsqueda persistente',
        history: this.historyNote?.trim() || null,
        extraFilter: extra,
        coverItemId: this.coverCandidateId || null,
      };

      this.busy.set(true);
      this.error.set(null);

      await firstValueFrom(
        this.api.post<any>(
          `/collections/${id}/derive`,
          body,
          this.authHeaders()
        )
      );

      this.router.navigate(['/collections']);
    } catch (e: any) {
      this.error.set(
        e?.error?.message ||
        e?.message ||
        'No se pudo crear la colección Smart'
      );
    } finally {
      this.busy.set(false);
    }
  }

  // --------- Navegación / meta ----------
  goBack(): void {
    this.router.navigateByUrl('/collections');
  }

  goItemDetail(itemId: number) {
    this.router.navigate(['/item', itemId]);
  }

  buildMeta(it: CollectionItemRow): string {
    const parts: string[] = [];
    if (it.country) parts.push(it.country);
    if (it.issueYear != null) parts.push(String(it.issueYear));
    parts.push(`#${it.id}`);
    return parts.join(' · ');
  }

  private async uniqueCollectionName(base: string): Promise<string> {
    try {
      const cols = await firstValueFrom(
        this.http.get<any[]>(`${API_BASE}/collections`, {
          headers: this.authHeaders(),
        })
      );
      const existing = new Set<string>((cols || []).map((c) => String(c.name)));
      if (!existing.has(base)) return base;

      let i = 2;
      let candidate = `${base} (${i})`;
      while (existing.has(candidate)) {
        i++;
        candidate = `${base} (${i})`;
      }
      return candidate;
    } catch {
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
      return `${base} ${stamp}`;
    }
  }
}
