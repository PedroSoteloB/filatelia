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
  tags?: { id: number; name: string }[];
  attributes?: { id: number; name: string; value: string }[];
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

// ✅ Catálogos (pero ahora scoped a la colección)
type TagDTO = { id: number; name: string };
type AttrDefDTO = { id: number; name: string; attrType: 'text' | 'number' | 'date' | 'list' };

// ✅ Tipos seguros para builder de atributos
type AttrOp = '=' | 'like' | 'between';

type AttrFilterBase = {
  id: number;
  name?: string | null;
  op: AttrOp;
};

type AttrFilterSingle = AttrFilterBase & {
  op: '=' | 'like';
  value: string;
};

type AttrFilterBetween = AttrFilterBase & {
  op: 'between';
  from: string;
  to: string;
};

type AttrFilter = AttrFilterSingle | AttrFilterBetween;

@Component({
  selector: 'app-collection-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection-detail.component.html',
  styleUrls: ['./collection-detail.component.scss'],
  host: { class: 'collection-detail-page' }
})
export class CollectionDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = inject(ApiService);

  busy = signal<boolean>(false);
  error = signal<string | null>(null);

  collectionId = signal<number | null>(null);
  items = signal<CollectionItemRow[]>([]);

  // ✅ Catálogos (AHORA: filtrados por la colección)
  // Países los derivamos de items() para que no aparezcan todos los del sistema.
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

  // ✅ Tags (search + chips)
  tagSearch = signal<string>('');
  selectedTagNames = signal<string[]>([]);

  filteredTags = computed(() => {
    const term = (this.tagSearch() || '').trim().toLowerCase();
    const tags = this.allTags() || [];
    if (!term) return [];
    const out = tags
      .filter(t => (t.name || '').toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return out.slice(0, 60);
  });

  selectedTags = computed(() => {
    const names = new Set(this.selectedTagNames().map(x => x.toLowerCase()));
    return (this.allTags() || []).filter(t => names.has(t.name.toLowerCase()));
  });

  setTagSearch(v: string) {
    this.tagSearch.set(v || '');
  }

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

  // ==========================
  // ✅ Atributos dinámicos (draft UI)
  // ==========================
  attrDraftId: number | null = null;
  attrDraftOp: AttrOp = '=';
  attrDraftValue: string = '';
  attrDraftFrom: string = '';
  attrDraftTo: string = '';

  attrFilters = signal<AttrFilter[]>([]);

  private findAttrNameById(id: number): string | null {
    const hit = this.allAttrDefs().find(x => x.id === id);
    return hit?.name ?? null;
  }

  onAddAttrClick() {
    // ✅ FIX: asegurar número real (por si el <select> te lo manda como string)
    const raw = this.attrDraftId as any;
    const id = typeof raw === 'string' ? Number(raw) : raw;

    if (!id || !Number.isFinite(id)) return;

    const op = this.attrDraftOp;
    const name = this.findAttrNameById(id);

    if (op === 'between') {
      const from = (this.attrDraftFrom || '').trim();
      const to = (this.attrDraftTo || '').trim();
      if (!from || !to) return;

      this.attrFilters.set([
        ...this.attrFilters(),
        { id, name, op: 'between', from, to }
      ]);
    } else {
      const value = (this.attrDraftValue || '').trim();
      if (!value) return;

      this.attrFilters.set([
        ...this.attrFilters(),
        { id, name, op, value }
      ]);
    }

    this.attrDraftValue = '';
    this.attrDraftFrom = '';
    this.attrDraftTo = '';
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

    this.collectionId.set(idNum);

    // ✅ Primero cargamos items (de ahí sacamos countries), y en paralelo tags/attrs scoped
    await Promise.all([
      this.loadItems(idNum),
      this.loadTagsForCollection(idNum),
      this.loadAttrDefsForCollection(idNum),
    ]);
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
  // ✅ Cargar tags/attrs (SCOPED A LA COLECCIÓN)
  // =========================
  async loadTagsForCollection(colId: number) {
    try {
      const tags = await firstValueFrom(
        this.http.get<TagDTO[]>(
          `${API_BASE}/collections/${colId}/tags`,
          { headers: this.authHeaders() }
        )
      );
      this.allTags.set(tags || []);
    } catch {
      this.allTags.set([]);
    }
  }

  async loadAttrDefsForCollection(colId: number) {
    try {
      const defs = await firstValueFrom(
        this.http.get<AttrDefDTO[]>(
          `${API_BASE}/collections/${colId}/attributes`,
          { headers: this.authHeaders() }
        )
      );
      this.allAttrDefs.set(defs || []);
    } catch {
      this.allAttrDefs.set([]);
    }
  }

  // =========================
  // ✅ Países SCOPED: derivado de los items de la colección (no global)
  // =========================
  private setCountriesFromItems(rows: CollectionItemRow[]) {
    const uniq = Array.from(
      new Set(
        (rows || [])
          .map(r => (r.country || '').trim())
          .filter(x => !!x)
      )
    ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    this.countries.set(uniq);
  }

  // --------- Carga base ----------
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

      const safeRows = rows || [];

      this.items.set(safeRows);
      this.setCountriesFromItems(safeRows);

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
    if (!id) return;

    await Promise.all([
      this.loadItems(id),
      // opcional: refrescar catálogos por si cambió la colección
      this.loadTagsForCollection(id),
      this.loadAttrDefsForCollection(id),
    ]);
  }

  // --------- Sub-búsqueda dentro de la colección ----------
  async runSubSearch() {
    try {
      const id = this.collectionId();
      if (!id) return;

      this.busy.set(true);
      this.error.set(null);

      const tagNames = this.selectedTagNames();
      const af = this.attrFilters();

      const f: SubFilter = {
        q: this.form.q?.trim() || undefined,
        country: this.form.country?.trim() || undefined,
        yearFrom: this.form.yearFrom != null ? Number(this.form.yearFrom) : undefined,
        yearTo: this.form.yearTo != null ? Number(this.form.yearTo) : undefined,
        tagNames: tagNames.length ? tagNames : undefined,
        tagsMode: (this.form.tagsMode || 'OR') as 'OR' | 'AND',
        attrs: af.length
          ? af.map(x => {
              if (x.op === 'between') {
                return { id: x.id, name: x.name, op: x.op, from: x.from, to: x.to };
              }
              return { id: x.id, name: x.name, op: x.op, value: x.value };
            })
          : undefined
      };

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

      // ✅ OJO: NO actualizamos countries acá,
      // porque el selector de país debe ser “de la colección”, no “del resultado filtrado”.
      // (si quisieras que cambie con la sub-búsqueda, aquí llamarías setCountriesFromItems)
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

    this.tagSearch.set('');
    this.selectedTagNames.set([]);
    this.attrFilters.set([]);

    this.attrDraftId = null;
    this.attrDraftOp = '=';
    this.attrDraftValue = '';
    this.attrDraftFrom = '';
    this.attrDraftTo = '';

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

      const extra: any = {};
      if (this.viewingSub) {
        extra.q = this.form.q?.trim() || undefined;
        extra.country = this.form.country?.trim() || undefined;
        if (this.form.yearFrom != null) extra.yearFrom = Number(this.form.yearFrom);
        if (this.form.yearTo != null) extra.yearTo = Number(this.form.yearTo);

        const tagNames = this.selectedTagNames();
        if (tagNames.length) extra.tagNames = tagNames;

        extra.tagsMode = this.form.tagsMode || 'OR';

        const af = this.attrFilters();
        if (af.length) {
          extra.attrs = af.map(x => {
            if (x.op === 'between') {
              return { id: x.id, name: x.name, op: x.op, from: x.from, to: x.to };
            }
            return { id: x.id, name: x.name, op: x.op, value: x.value };
          });
        }
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

  formatAttrFilter(af: AttrFilter): string {
    const label = af.name || `Attr #${af.id}`;
    if (af.op === 'between') {
      return `${label}: ${af.from} – ${af.to}`;
    }
    return `${label} ${af.op} ${af.value}`;
  }
}
