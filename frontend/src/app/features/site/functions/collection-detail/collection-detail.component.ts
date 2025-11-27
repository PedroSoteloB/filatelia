// import { Component, inject, signal, OnInit } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ActivatedRoute, Router } from '@angular/router';
// import { HttpClient } from '@angular/common/http';
// import { firstValueFrom } from 'rxjs';
// import { FormsModule } from '@angular/forms';

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
//   private route = inject(ActivatedRoute);
//   private http  = inject(HttpClient);
//   private router = inject(Router);

//   busy = signal<boolean>(false);
//   error = signal<string | null>(null);

//   collectionId = signal<number | null>(null);
//   items = signal<CollectionItemRow[]>([]);

//   // ---- Sub-búsqueda / selección ----
//   form: SubFilter = { q: '', country: '', yearFrom: undefined, yearTo: undefined, tagNames: [], tagsMode: 'OR', attrs: [] };
//   tagsComma = '';
//   attrsJson = '';
//   selectedIds = new Set<number>();
//   coverCandidateId: number | null = null;

//   historyNote: string = '';  // 👈 campo para la historia opcional de la colección

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

//   // --------- Carga base (sin filtros extra) ----------
//   async loadItems(id: number) {
//     try {
//       this.busy.set(true);
//       this.error.set(null);
//       const rows = await firstValueFrom(
//         this.http.get<CollectionItemRow[]>(`/collections/${id}/items`)
//       );
//       this.items.set(rows || []);
//       this.viewingSub = false;
//       this.selectedIds.clear();
//       this.coverCandidateId = null;
//     } catch (e: any) {
//       this.error.set(e?.message || 'No se pudieron cargar los ítems de la colección');
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
//         tagNames: this.tagsComma.split(',').map(s => s.trim()).filter(Boolean),
//         tagsMode: (this.form.tagsMode || 'OR') as 'OR'|'AND',
//       };

//       // attrs desde JSON (opcional)
//       if (this.attrsJson?.trim()) {
//         try { f.attrs = JSON.parse(this.attrsJson); }
//         catch { return this.error.set('Attrs JSON inválido'); }
//       }

//       // construir querystring
//       const qs = new URLSearchParams();
//       if (f.q) qs.set('q', f.q);
//       if (f.country) qs.set('country', f.country);
//       if (f.yearFrom != null) qs.set('yearFrom', String(f.yearFrom));
//       if (f.yearTo != null) qs.set('yearTo', String(f.yearTo));
//       if (f.tagNames && f.tagNames.length) {
//         f.tagNames.forEach(t => qs.append('tagNames', t));
//       }
//       if (f.tagsMode) qs.set('tagsMode', f.tagsMode);
//       if (f.attrs && f.attrs.length) qs.set('attrs', JSON.stringify(f.attrs));
//       qs.set('limit', '25'); // 50→25
//       qs.set('offset', '0');

//       const url = `/collections/${id}/items/search-sub?` + qs.toString();

//       const rows = await firstValueFrom(this.http.get<CollectionItemRow[]>(url));
//       this.items.set(rows || []);
//       this.viewingSub = true;
//       this.selectedIds.clear();
//       this.coverCandidateId = null;
//     } catch (e:any) {
//       this.error.set(e?.error?.message || e?.message || 'No se pudo ejecutar la sub-búsqueda');
//     } finally {
//       this.busy.set(false);
//     }
//   }

//   resetSubSearch() {
//     this.form = { q: '', country: '', yearFrom: undefined, yearTo: undefined, tagNames: [], tagsMode: 'OR', attrs: [] };
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
//   private async findOrCreatePresentation(collectionId: number, titleFallback: string): Promise<number> {
//     // Buscar si ya existe una presentación para esa colección
//     const presList = await firstValueFrom(this.http.get<any[]>(`/presentations?limit=100`));
//     const found = (presList || []).find(p => Number(p.collection_id) === Number(collectionId));
//     if (found?.id) return Number(found.id);

//     // Crear si no existe
//     const created = await firstValueFrom(this.http.post<any>(`/presentations`, {
//       collection_id: collectionId,
//       title: titleFallback || `Presentación de colección #${collectionId}`,
//       description: 'Generada desde UI'
//     }));
//     return Number(created.id);
//   }

//   private async generatePptForPresentation(presId: number, opts?: { maxSlides?: number }) {
//     // 1) Genera/actualiza el PPT en el backend
//     const qs = new URLSearchParams();
//     if (opts?.maxSlides != null) qs.set('maxSlides', String(opts.maxSlides));
//     await firstValueFrom(
//       this.http.post(`/presentations/${presId}/generate-ppt?${qs.toString()}`, {})
//     );
  
//     // 2) Descarga con HttpClient (con Authorization) y dispara la descarga
//     await this.downloadPpt(presId);
//   }
  
//   private async downloadPpt(presId: number) {
//     const resp = await firstValueFrom(
//       this.http.get(`/presentations/${presId}/ppt`, {
//         responseType: 'blob',
//         observe: 'response'
//       })
//     );
  
//     // Intenta extraer nombre de archivo del header Content-Disposition
//     let filename = `presentation-${presId}.pptx`;
//     const dispo = resp.headers.get('Content-Disposition') || resp.headers.get('content-disposition');
//     if (dispo) {
//       const m = /filename="?([^"]+)"?/i.exec(dispo);
//       if (m?.[1]) filename = m[1];
//     }
  
//     const blob = resp.body as Blob;
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = url;
//     a.download = filename;
//     document.body.appendChild(a);
//     a.click();
//     a.remove();
//     URL.revokeObjectURL(url);
//   }
  

//   // --------- Crear derivadas ----------
//   // genPpt: si true, encadena creación de presentación + PPT
//   async createSnapshot(genPpt = false) {
//     try {
//       const id = this.collectionId();
//       if (!id) return;

//       if (this.selectedIds.size === 0) {
//         this.error.set('Selecciona 10–15 ítems para crear Snapshot.');
//         return;
//       }

//       const baseName = `Subconjunto de #${id} (${this.selectedIds.size} ítems)`;
//       const name = await this.uniqueCollectionName(baseName);

//       const body = {
//         mode: 'snapshot',
//         name,
//         description: 'Creado desde sub-búsqueda',
//         history: this.historyNote || null,
//         selectedItemIds: Array.from(this.selectedIds),
//         coverItemId: this.coverCandidateId ?? Array.from(this.selectedIds)[0]
//       };

//       this.busy.set(true);
//       this.error.set(null);

//       // ⬇️ Deriva la colección (el back devuelve { id, presentationId, ... })
//       const resp = await firstValueFrom(this.http.post<any>(`/collections/${id}/derive`, body));
//       const childId = Number(resp.id);
//       const presIdFromBack = Number(resp.presentationId || 0);

//       // ⬇️ Si hay que generar PPT, usa el presentationId devuelto; si no viene, haz fallback
//       if (genPpt) {
//         const presId = presIdFromBack || await this.findOrCreatePresentation(childId, name);
//         await this.generatePptForPresentation(presId, { maxSlides: 15 });
//       }

//       this.router.navigate(['/collections']);
//     } catch (e: any) {
//       // Fallback si choca por duplicado: reintenta con nombre único y también genera PPT si corresponde
//       if (e?.status === 409 || /Duplicate entry/i.test(e?.error?.message || '')) {
//         try {
//           const id = this.collectionId()!;
//           const retryName = await this.uniqueCollectionName(
//             `Subconjunto de #${id} (${this.selectedIds.size} ítems)`
//           );
//           const body = {
//             mode: 'snapshot',
//             name: retryName,
//             description: 'Creado desde sub-búsqueda',
//             selectedItemIds: Array.from(this.selectedIds),
//             coverItemId: this.coverCandidateId ?? Array.from(this.selectedIds)[0]
//           };

//           const resp2 = await firstValueFrom(this.http.post<any>(`/collections/${id}/derive`, body));
//           const childId2 = Number(resp2.id);
//           const presId2 = Number(resp2.presentationId || 0);

//           if (genPpt) {
//             const pid = presId2 || await this.findOrCreatePresentation(childId2, retryName);
//             await this.generatePptForPresentation(pid, { maxSlides: 15 });
//           }

//           this.router.navigate(['/collections']);
//           return;
//         } catch {}
//       }

//       this.error.set(e?.error?.message || e?.message || 'No se pudo crear la colección Snapshot');
//     } finally {
//       this.busy.set(false);
//     }
//   }


//   async createSmart() {
//     try {
//       const id = this.collectionId();
//       if (!id) return;

//       // si no estamos viendo sub-búsqueda, no hay filtros extra
//       const extra: any = {};
//       if (this.viewingSub) {
//         extra.q = this.form.q?.trim() || undefined;
//         extra.country = this.form.country?.trim() || undefined;
//         if (this.form.yearFrom != null) extra.yearFrom = Number(this.form.yearFrom);
//         if (this.form.yearTo != null)   extra.yearTo   = Number(this.form.yearTo);
//         const tagNames = this.tagsComma.split(',').map(s => s.trim()).filter(Boolean);
//         if (tagNames.length) extra.tagNames = tagNames;
//         extra.tagsMode = (this.form.tagsMode || 'OR');
//         if (this.attrsJson?.trim()) {
//           try { extra.attrs = JSON.parse(this.attrsJson); }
//           catch { return this.error.set('Attrs JSON inválido'); }
//         }
//       }

//       const body = {
//         mode: 'smart',
//         name: `Smart de #${id}`,
//         description: 'Sub-búsqueda persistente',
//         extraFilter: extra,
//         coverItemId: this.coverCandidateId || null
//       };

//       this.busy.set(true); 
//       this.error.set(null);

//       const resp = await firstValueFrom(this.http.post<any>(`/collections/${id}/derive`, body));
//       this.router.navigate(['/collections']); // o: this.router.navigate(['/collections', resp.id]);
//     } catch (e:any) {
//       this.error.set(e?.error?.message || e?.message || 'No se pudo crear la colección Smart');
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
//       // Trae tus colecciones (el endpoint ya existe en tu back)
//       const cols = await firstValueFrom(this.http.get<any[]>(`/collections`));
//       const existing = new Set<string>((cols || []).map(c => String(c.name)));
//       if (!existing.has(base)) return base;

//       let i = 2;
//       let candidate = `${base} (${i})`;
//       while (existing.has(candidate)) {
//         i++;
//         candidate = `${base} (${i})`;
//       }
//       return candidate;
//     } catch {
//       // Si falla el fetch, al menos evita el choque con timestamp corto
//       const stamp = new Date().toISOString().slice(11,19).replace(/:/g,'');
//       return `${base} ${stamp}`;
//     }
//   }
// }
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';

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
  private http  = inject(HttpClient);
  private router = inject(Router);

  busy = signal<boolean>(false);
  error = signal<string | null>(null);

  collectionId = signal<number | null>(null);
  items = signal<CollectionItemRow[]>([]);

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
  tagsComma = '';
  attrsJson = '';
  selectedIds = new Set<number>();
  coverCandidateId: number | null = null;

  // 👇 historia opcional de la colección (se manda al back como "history")
  historyNote: string = '';

  // Para saber si estamos viendo base o resultado de sub-búsqueda
  private viewingSub = false;

  async ngOnInit() {
    const rawId = this.route.snapshot.paramMap.get('id');
    const idNum = Number(rawId);
    if (!Number.isFinite(idNum)) {
      this.error.set('ID de colección inválido');
      return;
    }
    this.collectionId.set(idNum);
    await this.loadItems(idNum); // base (colección)
  }

  // --------- Carga base (sin filtros extra) ----------
  async loadItems(id: number) {
    try {
      this.busy.set(true);
      this.error.set(null);
      const rows = await firstValueFrom(
        this.http.get<CollectionItemRow[]>(`/collections/${id}/items`)
      );
      this.items.set(rows || []);
      this.viewingSub = false;
      this.selectedIds.clear();
      this.coverCandidateId = null;
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron cargar los ítems de la colección');
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

      // armar filtros desde UI
      const f: SubFilter = {
        q: this.form.q?.trim() || undefined,
        country: this.form.country?.trim() || undefined,
        yearFrom: this.form.yearFrom ? Number(this.form.yearFrom) : undefined,
        yearTo: this.form.yearTo ? Number(this.form.yearTo) : undefined,
        tagNames: this.tagsComma.split(',').map(s => s.trim()).filter(Boolean),
        tagsMode: (this.form.tagsMode || 'OR') as 'OR' | 'AND',
      };

      // attrs desde JSON (opcional)
      if (this.attrsJson?.trim()) {
        try { f.attrs = JSON.parse(this.attrsJson); }
        catch {
          this.error.set('Attrs JSON inválido');
          return;
        }
      }

      // construir querystring
      const qs = new URLSearchParams();
      if (f.q) qs.set('q', f.q);
      if (f.country) qs.set('country', f.country);
      if (f.yearFrom != null) qs.set('yearFrom', String(f.yearFrom));
      if (f.yearTo != null) qs.set('yearTo', String(f.yearTo));
      if (f.tagNames && f.tagNames.length) {
        f.tagNames.forEach(t => qs.append('tagNames', t));
      }
      if (f.tagsMode) qs.set('tagsMode', f.tagsMode);
      if (f.attrs && f.attrs.length) qs.set('attrs', JSON.stringify(f.attrs));
      qs.set('limit', '25'); // 50→25
      qs.set('offset', '0');

      const url = `/collections/${id}/items/search-sub?` + qs.toString();

      const rows = await firstValueFrom(this.http.get<CollectionItemRow[]>(url));
      this.items.set(rows || []);
      this.viewingSub = true;
      this.selectedIds.clear();
      this.coverCandidateId = null;
    } catch (e:any) {
      this.error.set(e?.error?.message || e?.message || 'No se pudo ejecutar la sub-búsqueda');
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
      attrs: []
    };
    this.tagsComma = '';
    this.attrsJson = '';
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
  private async findOrCreatePresentation(collectionId: number, titleFallback: string): Promise<number> {
    // Buscar si ya existe una presentación para esa colección
    const presList = await firstValueFrom(this.http.get<any[]>(`/presentations?limit=100`));
    const found = (presList || []).find(p => Number(p.collection_id) === Number(collectionId));
    if (found?.id) return Number(found.id);

    // Crear si no existe
    const created = await firstValueFrom(this.http.post<any>(`/presentations`, {
      collection_id: collectionId,
      title: titleFallback || `Presentación de colección #${collectionId}`,
      description: 'Generada desde UI'
    }));
    return Number(created.id);
  }

  private async generatePptForPresentation(presId: number, opts?: { maxSlides?: number }) {
    // 1) Genera/actualiza el PPT en el backend
    const qs = new URLSearchParams();
    if (opts?.maxSlides != null) qs.set('maxSlides', String(opts.maxSlides));
    await firstValueFrom(
      this.http.post(`/presentations/${presId}/generate-ppt?${qs.toString()}`, {})
    );
  
    // 2) Descarga con HttpClient (con Authorization) y dispara la descarga
    await this.downloadPpt(presId);
  }
  
  private async downloadPpt(presId: number) {
    const resp = await firstValueFrom(
      this.http.get<{ presentonUrl: string | null; downloadUrl: string | null; filePath: string | null }>(
        `/presentations/${presId}/ppt`
      )
    );
  
    // 1) Prioridad: Abrir / descargar en Presenton
    if (resp.presentonUrl) {
      window.open(resp.presentonUrl, '_blank');  // 👈 este es el botón "Abrir / descargar en Presenton"
      return;
    }
  
    // 2) Fallback: URL directa (S3 u otro)
    if (resp.downloadUrl) {
      window.open(resp.downloadUrl, '_blank');
      return;
    }
  
    // 3) Último recurso: nada encontrado
    alert('No se encontró PPT para esta presentación');
  }
  

  // --------- Crear derivadas ----------
  // genPpt: si true, encadena creación de presentación + PPT
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
        history: this.historyNote?.trim() || null,    // 👈 se envía al back
        selectedItemIds: Array.from(this.selectedIds),
        coverItemId: this.coverCandidateId ?? Array.from(this.selectedIds)[0]
      };

      this.busy.set(true);
      this.error.set(null);

      // Deriva la colección (el back devuelve { id, presentationId, ... })
      const resp = await firstValueFrom(this.http.post<any>(`/collections/${id}/derive`, body));
      const childId = Number(resp.id);
      const presIdFromBack = Number(resp.presentationId || 0);

      // Si hay que generar PPT, usa el presentationId devuelto; si no viene, fallback
      if (genPpt) {
        const presId = presIdFromBack || await this.findOrCreatePresentation(childId, name);
        await this.generatePptForPresentation(presId, { maxSlides: 15 });
      }

      this.router.navigate(['/collections']);
    } catch (e: any) {
      // Fallback si choca por duplicado: reintenta con nombre único y también genera PPT si corresponde
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
            history: this.historyNote?.trim() || null,   // 👈 también en el retry
            selectedItemIds: Array.from(this.selectedIds),
            coverItemId: this.coverCandidateId ?? Array.from(this.selectedIds)[0]
          };

          const resp2 = await firstValueFrom(this.http.post<any>(`/collections/${id}/derive`, body));
          const childId2 = Number(resp2.id);
          const presId2 = Number(resp2.presentationId || 0);

          if (genPpt) {
            const pid = presId2 || await this.findOrCreatePresentation(childId2, retryName);
            await this.generatePptForPresentation(pid, { maxSlides: 15 });
          }

          this.router.navigate(['/collections']);
          return;
        } catch {}
      }

      this.error.set(e?.error?.message || e?.message || 'No se pudo crear la colección Snapshot');
    } finally {
      this.busy.set(false);
    }
  }

  async createSmart() {
    try {
      const id = this.collectionId();
      if (!id) return;

      // si no estamos viendo sub-búsqueda, no hay filtros extra
      const extra: any = {};
      if (this.viewingSub) {
        extra.q = this.form.q?.trim() || undefined;
        extra.country = this.form.country?.trim() || undefined;
        if (this.form.yearFrom != null) extra.yearFrom = Number(this.form.yearFrom);
        if (this.form.yearTo != null)   extra.yearTo   = Number(this.form.yearTo);
        const tagNames = this.tagsComma.split(',').map(s => s.trim()).filter(Boolean);
        if (tagNames.length) extra.tagNames = tagNames;
        extra.tagsMode = (this.form.tagsMode || 'OR');
        if (this.attrsJson?.trim()) {
          try { extra.attrs = JSON.parse(this.attrsJson); }
          catch {
            this.error.set('Attrs JSON inválido');
            return;
          }
        }
      }

      const body = {
        mode: 'smart',
        name: `Smart de #${id}`,
        description: 'Sub-búsqueda persistente',
        history: this.historyNote?.trim() || null,   // 👈 también permitimos historia en smart
        extraFilter: extra,
        coverItemId: this.coverCandidateId || null
      };

      this.busy.set(true); 
      this.error.set(null);

      const resp = await firstValueFrom(this.http.post<any>(`/collections/${id}/derive`, body));
      this.router.navigate(['/collections']); // o: this.router.navigate(['/collections', resp.id]);
    } catch (e:any) {
      this.error.set(e?.error?.message || e?.message || 'No se pudo crear la colección Smart');
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

  // Devuelve un nombre único agregando " (2)", " (3)", ... si ya existe
  private async uniqueCollectionName(base: string): Promise<string> {
    try {
      // Trae tus colecciones (el endpoint ya existe en tu back)
      const cols = await firstValueFrom(this.http.get<any[]>(`/collections`));
      const existing = new Set<string>((cols || []).map(c => String(c.name)));
      if (!existing.has(base)) return base;

      let i = 2;
      let candidate = `${base} (${i})`;
      while (existing.has(candidate)) {
        i++;
        candidate = `${base} (${i})`;
      }
      return candidate;
    } catch {
      // Si falla el fetch, al menos evita el choque con timestamp corto
      const stamp = new Date().toISOString().slice(11,19).replace(/:/g,'');
      return `${base} ${stamp}`;
    }
  }
}
