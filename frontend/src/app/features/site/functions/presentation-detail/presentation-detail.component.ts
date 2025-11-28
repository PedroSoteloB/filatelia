// import { Component, computed, effect, signal, inject } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ActivatedRoute, Router, RouterModule } from '@angular/router';
// import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
// import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';

// type Pres = {
//   id: number;
//   title: string;
//   description?: string | null;
//   cover?: string | null;
//   collection_id: number;
//   created_at: string;
//   updated_at: string;
//   assetsCount?: number;
// };

// // 👇 único cambio útil: tipar mejor metaJson
// type AssetMeta = {
//   caption?: string;
//   edit_path?: string;
//   [key: string]: any;
// };

// type Asset = {
//   id: number;
//   kind: 'video'|'ppt'|'image'|'text'|'link';
//   filePath?: string | null;
//   url?: string | null;
//   metaJson?: AssetMeta;   // ⬅️ aquí
//   createdAt: string;
// };

// @Component({
//   selector: 'app-presentation-detail',
//   standalone: true,
//   imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule],
//   templateUrl: './presentation-detail.component.html',
//   styleUrls: ['./presentation-detail.component.scss']
// })
// export class PresentationDetailComponent {
//   private api = ''; // proxy o base URL

//   private fb = inject(FormBuilder);
//   private route = inject(ActivatedRoute);
//   private http = inject(HttpClient);
//   private router = inject(Router);

//   id = signal<number | null>(null);
//   loading = signal<boolean>(true);
//   saving = signal<boolean>(false);
//   error = signal<string | null>(null);

//   pres = signal<Pres | null>(null);
//   assets = signal<Asset[]>([]);
//   hasCover = computed(() => !!this.pres()?.cover);

//   editForm = this.fb.group({
//     title: ['', [Validators.required, Validators.maxLength(180)]],
//     description: ['']
//   });

//   newKind = signal<'image'|'ppt'|'video'|'link'|'text'>('image');
//   newUrl  = signal<string>('');
//   newText = signal<string>('');
//   newFile: File | null = null;

//   constructor(){
//     this.route.paramMap.subscribe(p => {
//       const pid = Number(p.get('id'));
//       if (!Number.isFinite(pid)) { this.error.set('ID inválido'); return; }
//       this.id.set(pid);
//       this.loadAll();
//     });

//     effect(() => {
//       const p = this.pres();
//       if (p) {
//         this.editForm.patchValue(
//           { title: p.title, description: p.description ?? '' },
//           { emitEvent: false }
//         );
//       }
//     });
//   }

//   async loadAll(){
//     try{
//       this.loading.set(true);
//       this.error.set(null);
//       const pid = this.id()!;
//       const pres = await this.http.get<Pres>(`${this.api}/presentations/${pid}`).toPromise();
//       this.pres.set(pres!);
//       const assets = await this.http.get<Asset[]>(`${this.api}/presentations/${pid}/assets`).toPromise();
//       this.assets.set(assets || []);
//     }catch(e:any){
//       this.handleError(e);
//     }finally{
//       this.loading.set(false);
//     }
//   }

//   async saveMeta(){
//     if (this.editForm.invalid || !this.pres()) return;
//     try{
//       this.saving.set(true);
//       const pid = this.pres()!.id;
//       const body = {
//         title: this.editForm.value.title?.trim(),
//         description: (this.editForm.value.description ?? '').trim()
//       };
//       await this.http.put(`${this.api}/presentations/${pid}`, body).toPromise();
//       const updated = await this.http.get<Pres>(`${this.api}/presentations/${pid}`).toPromise();
//       this.pres.set(updated!);
//     }catch(e:any){
//       this.handleError(e);
//     }finally{
//       this.saving.set(false);
//     }
//   }

//   async onCoverChange(evt: Event){
//     const inp = evt.target as HTMLInputElement;
//     const file = inp.files?.[0];
//     if (!file || !this.pres()) return;
//     try{
//       this.saving.set(true);
//       const pid = this.pres()!.id;
//       const fd = new FormData();
//       fd.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json'}));
//       fd.append('cover', file, file.name);
//       await this.http.put(`${this.api}/presentations/${pid}`, fd, {
//         headers: new HttpHeaders({})
//       }).toPromise();
//       await this.reloadPresOnly();
//     }catch(e:any){
//       this.handleError(e);
//     }finally{
//       (evt.target as HTMLInputElement).value = '';
//       this.saving.set(false);
//     }
//   }

//   async clearCover(){
//     if (!this.pres()) return;
//     try{
//       this.saving.set(true);
//       const pid = this.pres()!.id;
//       await this.http.put(`${this.api}/presentations/${pid}`, { clearCover: true }).toPromise();
//       await this.reloadPresOnly();
//     }catch(e:any){
//       this.handleError(e);
//     }finally{
//       this.saving.set(false);
//     }
//   }

//   private async reloadPresOnly(){
//     const pid = this.pres()!.id;
//     const updated = await this.http.get<Pres>(`${this.api}/presentations/${pid}`).toPromise();
//     this.pres.set(updated!);
//   }

//   onFileChange(ev: Event){
//     const inp = ev.target as HTMLInputElement;
//     this.newFile = inp.files?.[0] ?? null;
//   }

//   async addAsset(){
//     const pres = this.pres(); if (!pres) return;
//     const kind = this.newKind();
//     try{
//       this.saving.set(true);

//       if (kind === 'text'){
//         const meta: AssetMeta = { caption: (this.newText() || '').trim() };
//         await this.http.post(`${this.api}/presentations/${pres.id}/assets`, {
//           kind, meta_json: meta
//         }).toPromise();
//       } else if (kind === 'link'){
//         const url = (this.newUrl() || '').trim();
//         if (!url) throw new Error('URL requerida');
//         await this.http.post(`${this.api}/presentations/${pres.id}/assets`, {
//           kind, url
//         }).toPromise();
//       } else {
//         if (!this.newFile) throw new Error('Archivo requerido');
//         const fd = new FormData();
//         fd.append('kind', kind);
//         fd.append('file', this.newFile, this.newFile.name);
//         await this.http.post(`${this.api}/presentations/${pres.id}/assets`, fd).toPromise();
//       }

//       this.newUrl.set('');
//       this.newText.set('');
//       this.newFile = null;
//       const f = document.getElementById('asset-file') as HTMLInputElement | null;
//       if (f) f.value = '';

//       const assets = await this.http.get<Asset[]>(`${this.api}/presentations/${pres.id}/assets`).toPromise();
//       this.assets.set(assets || []);
//     }catch(e:any){
//       this.handleError(e);
//     }finally{
//       this.saving.set(false);
//     }
//   }

//   async deleteAsset(a: Asset){
//     const pres = this.pres(); if (!pres) return;
//     if (!confirm('¿Eliminar este recurso?')) return;
//     try{
//       this.saving.set(true);
//       await this.http.delete(`${this.api}/presentations/${pres.id}/assets/${a.id}`).toPromise();
//       this.assets.set(this.assets().filter(x => x.id !== a.id));
//     }catch(e:any){
//       this.handleError(e);
//     }finally{
//       this.saving.set(false);
//     }
//   }

//   fmtDate(d?: string){ return d ? new Date(d) : null; }
//   kindIcon(a: Asset){
//     switch(a.kind){
//       case 'image': return '🖼️';
//       case 'video': return '🎬';
//       case 'ppt':   return '📑';
//       case 'link':  return '🔗';
//       case 'text':  return '📝';
//       default:      return '📄';
//     }
//   }
//   isMedia(a: Asset){ return a.kind === 'image' || a.kind === 'video'; }

//   back(){ this.router.navigate(['/presentations']); }

//   private handleError(e: any){
//     const msg = (e as HttpErrorResponse)?.error?.message || (e as Error)?.message || 'error';
//     this.error.set(msg);
//     console.error(e);
//   }
// }
import { Component, computed, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpClientModule } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';

// 👇 IMPORTA environment (usa la MISMA ruta que en presentations-home o my-items)
import { environment } from '../../../../core/environments/environment';

type Pres = {
  id: number;
  title: string;
  description?: string | null;
  cover?: string | null;
  collection_id: number;
  created_at: string;
  updated_at: string;
  assetsCount?: number;
};

// 👇 único cambio útil: tipar mejor metaJson
type AssetMeta = {
  caption?: string;
  edit_path?: string;
  [key: string]: any;
};

type Asset = {
  id: number;
  kind: 'video'|'ppt'|'image'|'text'|'link';
  filePath?: string | null;
  url?: string | null;
  metaJson?: AssetMeta;   // ⬅️ aquí
  createdAt: string;
};

@Component({
  selector: 'app-presentation-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule, HttpClientModule],
  templateUrl: './presentation-detail.component.html',
  styleUrls: ['./presentation-detail.component.scss']
})
export class PresentationDetailComponent {
  // 🔹 AHORA base URL viene del environment → Azure o lo que tengas configurado
  private api = environment.apiBaseUrl;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private router = inject(Router);

  id = signal<number | null>(null);
  loading = signal<boolean>(true);
  saving = signal<boolean>(false);
  error = signal<string | null>(null);

  pres = signal<Pres | null>(null);
  assets = signal<Asset[]>([]);
  hasCover = computed(() => !!this.pres()?.cover);

  editForm = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(180)]],
    description: ['']
  });

  newKind = signal<'image'|'ppt'|'video'|'link'|'text'>('image');
  newUrl  = signal<string>('');
  newText = signal<string>('');
  newFile: File | null = null;

  constructor(){
    this.route.paramMap.subscribe(p => {
      const pid = Number(p.get('id'));
      if (!Number.isFinite(pid)) { this.error.set('ID inválido'); return; }
      this.id.set(pid);
      this.loadAll();
    });

    effect(() => {
      const p = this.pres();
      if (p) {
        this.editForm.patchValue(
          { title: p.title, description: p.description ?? '' },
          { emitEvent: false }
        );
      }
    });
  }

  async loadAll(){
    try{
      this.loading.set(true);
      this.error.set(null);
      const pid = this.id()!;
      const pres = await this.http.get<Pres>(`${this.api}/presentations/${pid}`).toPromise();
      this.pres.set(pres!);
      const assets = await this.http.get<Asset[]>(`${this.api}/presentations/${pid}/assets`).toPromise();
      this.assets.set(assets || []);
    }catch(e:any){
      this.handleError(e);
    }finally{
      this.loading.set(false);
    }
  }

  async saveMeta(){
    if (this.editForm.invalid || !this.pres()) return;
    try{
      this.saving.set(true);
      const pid = this.pres()!.id;
      const body = {
        title: this.editForm.value.title?.trim(),
        description: (this.editForm.value.description ?? '').trim()
      };
      await this.http.put(`${this.api}/presentations/${pid}`, body).toPromise();
      const updated = await this.http.get<Pres>(`${this.api}/presentations/${pid}`).toPromise();
      this.pres.set(updated!);
    }catch(e:any){
      this.handleError(e);
    }finally{
      this.saving.set(false);
    }
  }

  async onCoverChange(evt: Event){
    const inp = evt.target as HTMLInputElement;
    const file = inp.files?.[0];
    if (!file || !this.pres()) return;
    try{
      this.saving.set(true);
      const pid = this.pres()!.id;
      const fd = new FormData();
      fd.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json'}));
      fd.append('cover', file, file.name);
      await this.http.put(`${this.api}/presentations/${pid}`, fd, {
        headers: new HttpHeaders({})
      }).toPromise();
      await this.reloadPresOnly();
    }catch(e:any){
      this.handleError(e);
    }finally{
      (evt.target as HTMLInputElement).value = '';
      this.saving.set(false);
    }
  }

  async clearCover(){
    if (!this.pres()) return;
    try{
      this.saving.set(true);
      const pid = this.pres()!.id;
      await this.http.put(`${this.api}/presentations/${pid}`, { clearCover: true }).toPromise();
      await this.reloadPresOnly();
    }catch(e:any){
      this.handleError(e);
    }finally{
      this.saving.set(false);
    }
  }

  private async reloadPresOnly(){
    const pid = this.pres()!.id;
    const updated = await this.http.get<Pres>(`${this.api}/presentations/${pid}`).toPromise();
    this.pres.set(updated!);
  }

  onFileChange(ev: Event){
    const inp = ev.target as HTMLInputElement;
    this.newFile = inp.files?.[0] ?? null;
  }

  async addAsset(){
    const pres = this.pres(); if (!pres) return;
    const kind = this.newKind();
    try{
      this.saving.set(true);

      if (kind === 'text'){
        const meta: AssetMeta = { caption: (this.newText() || '').trim() };
        await this.http.post(`${this.api}/presentations/${pres.id}/assets`, {
          kind, meta_json: meta
        }).toPromise();
      } else if (kind === 'link'){
        const url = (this.newUrl() || '').trim();
        if (!url) throw new Error('URL requerida');
        await this.http.post(`${this.api}/presentations/${pres.id}/assets`, {
          kind, url
        }).toPromise();
      } else {
        if (!this.newFile) throw new Error('Archivo requerido');
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('file', this.newFile, this.newFile.name);
        await this.http.post(`${this.api}/presentations/${pres.id}/assets`, fd).toPromise();
      }

      this.newUrl.set('');
      this.newText.set('');
      this.newFile = null;
      const f = document.getElementById('asset-file') as HTMLInputElement | null;
      if (f) f.value = '';

      const assets = await this.http.get<Asset[]>(`${this.api}/presentations/${pres.id}/assets`).toPromise();
      this.assets.set(assets || []);
    }catch(e:any){
      this.handleError(e);
    }finally{
      this.saving.set(false);
    }
  }

  async deleteAsset(a: Asset){
    const pres = this.pres(); if (!pres) return;
    if (!confirm('¿Eliminar este recurso?')) return;
    try{
      this.saving.set(true);
      await this.http.delete(`${this.api}/presentations/${pres.id}/assets/${a.id}`).toPromise();
      this.assets.set(this.assets().filter(x => x.id !== a.id));
    }catch(e:any){
      this.handleError(e);
    }finally{
      this.saving.set(false);
    }
  }

  fmtDate(d?: string){ return d ? new Date(d) : null; }
  kindIcon(a: Asset){
    switch(a.kind){
      case 'image': return '🖼️';
      case 'video': return '🎬';
      case 'ppt':   return '📑';
      case 'link':  return '🔗';
      case 'text':  return '📝';
      default:      return '📄';
    }
  }
  isMedia(a: Asset){ return a.kind === 'image' || a.kind === 'video'; }

  back(){ this.router.navigate(['/presentations']); }

  private handleError(e: any){
    const msg = (e as HttpErrorResponse)?.error?.message || (e as Error)?.message || 'error';
    this.error.set(msg);
    console.error(e);
  }
}
